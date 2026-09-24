import { describe, expect, it } from 'vitest';

import type {
  AuditEventDraft,
  AuditEventRecord,
  Role,
  RunRecord,
  RunState,
} from '@intellifin/domain';

import type { AuditUnitOfWork } from '../audit/ports.js';
import {
  acquireRunControlLease,
  parseRunControlLeaseRequest,
  releaseRunControlLease,
  renewRunControlLease,
  RUN_CONTROL_LEASE_ACQUIRED_EVENT,
  RUN_CONTROL_LEASE_EXPIRED_EVENT,
  RUN_CONTROL_LEASE_RELEASED_EVENT,
  RUN_CONTROL_LEASE_RENEWED_EVENT,
  RUN_CONTROL_LEASE_REFUSALS,
  type RunControlLeaseContext,
  type RunControlLeaseDependencies,
  type RunControlLeaseState,
} from './run-control-lease.js';

const RUN_ID = '019823ab-0000-7000-8000-000000000001';
const OTHER_RUN_ID = '019823ab-0000-7000-8000-000000000002';
const SESSION_A = { userId: 'auditor-a', sessionId: 'session-a' };
const SESSION_B = { userId: 'auditor-b', sessionId: 'session-b' };
const AT = '2026-09-19T10:00:00.000Z';

function runRecord(state: RunState = 'RUNNING', runId = RUN_ID): RunRecord {
  return {
    runId,
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
    requestToken: 'request-token',
    predecessorRunId: null,
    rerunReason: null,
    cancellation: null,
    pauseRequest: null,
  };
}

function lease(overrides: Partial<RunControlLeaseState> = {}): RunControlLeaseState {
  return {
    runId: RUN_ID,
    epoch: 1,
    holderId: 'auditor-a',
    expiresAt: '2026-09-19T10:02:00.000Z',
    updatedAt: AT,
    ...overrides,
  };
}

interface HarnessOptions {
  readonly run?: RunRecord | null;
  readonly state?: RunControlLeaseState | null;
  readonly now?: string;
  readonly role?: Role | null;
  readonly lockedRole?: Role | null;
  readonly allowEnrollment?: boolean;
}

interface Harness {
  readonly dependencies: RunControlLeaseDependencies;
  readonly events: AuditEventDraft[];
  readonly denials: AuditEventDraft[];
  readonly saved: RunControlLeaseState[];
  readonly notifications: number[];
  readonly transactionRunIds: string[];
  readonly currentState: () => RunControlLeaseState | null;
  readonly operations: string[];
}

/**
 * This fake keeps the repository boundary honest: the Run, fresh role, lease row, audit
 * writer and notification are all supplied by one transaction context. Its queue models
 * the canonical Run lock, so the concurrent test below observes committed state in order.
 */
function harness(options: HarnessOptions = {}): Harness {
  let current = options.state === undefined ? null : options.state;
  const events: AuditEventDraft[] = [];
  const records: AuditEventRecord[] = [];
  const denials: AuditEventDraft[] = [];
  const saved: RunControlLeaseState[] = [];
  const notifications: number[] = [];
  const transactionRunIds: string[] = [];
  const operations: string[] = [];
  let correlationNumber = 0;
  let queue = Promise.resolve();
  const role = options.role === undefined ? 'auditor' : options.role;
  const lockedRole = Object.hasOwn(options, 'lockedRole') ? options.lockedRole ?? null : role;
  const run = options.run === undefined ? runRecord() : options.run;

  const append = async (draft: AuditEventDraft): Promise<AuditEventRecord> => {
    operations.push('audit');
    events.push(draft);
    const record = {
      ...draft,
      eventId: `019823ab-0000-7000-8000-0000000000${events.length + 10}`,
      aggregateId: draft.aggregateId ?? 'platform',
      occurredAt: AT,
      sequence: events.length,
      previousHash: '0'.repeat(64),
      eventHash: '1'.repeat(64),
    } as AuditEventRecord;
    records.push(record);
    return record;
  };

  const unitOfWork: AuditUnitOfWork = {
    execute: async (work) => {
      const value = await work({
        auditEvents: {
          append: async (draft) => {
            denials.push(draft);
            return {
              ...draft,
              eventId: '019823ab-0000-7000-8000-0000000000de',
              aggregateId: draft.aggregateId ?? 'platform',
              occurredAt: AT,
              sequence: denials.length,
              previousHash: '0'.repeat(64),
              eventHash: '1'.repeat(64),
            } as AuditEventRecord;
          },
        },
      });
      return value;
    },
  };

  const repository = {
    transaction: async <T>(runId: string, work: (context: RunControlLeaseContext) => Promise<T>): Promise<T> => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      transactionRunIds.push(runId);
      try {
        const context: RunControlLeaseContext = {
          run,
          authorizationRoles: { findRole: async () => lockedRole },
          now: new Date(options.now ?? AT),
          auditEvents: { append },
          readRenewalEvent: async (actorId, requestKey) => records.find(event => event.actor.id === actorId && event.payload.requestKey === requestKey) ?? null,
          readLease: async () => current,
          saveLease: async (next) => {
            operations.push('save');
            current = next;
            saved.push(next);
          },
          notifyTimeline: async (sequence) => {
            operations.push('notify');
            notifications.push(sequence);
          },
        };
        return await work(context);
      } finally {
        release();
      }
    },
  };

  const dependencies: RunControlLeaseDependencies = {
    roles: { findRole: async () => role },
    unitOfWork,
    repository,
    ids: { next: () => `019823ab-0000-7000-8000-0000000000${++correlationNumber}` },
    allowEnrollment: options.allowEnrollment ?? true,
  };
  return {
    dependencies,
    events,
    denials,
    saved,
    notifications,
    transactionRunIds,
    currentState: () => current,
    operations,
  };
}

function request(expectedEpoch: number, runId = RUN_ID): { runId: string; expectedEpoch: number } {
  return { runId, expectedEpoch };
}

const REQUEST_KEY = '019823ab-0000-7000-8000-000000000099';
function renewal(expectedEpoch: number) { return { ...request(expectedEpoch), requestKey: REQUEST_KEY }; }

describe('run-control-lease request parser', () => {
  it('accepts only Run plus a nonnegative safe epoch and normalizes the Run id', () => {
    expect(parseRunControlLeaseRequest({ runId: RUN_ID.toUpperCase(), expectedEpoch: 0 })).toEqual({ runId: RUN_ID, expectedEpoch: 0 });
  });

  it.each([
    null,
    [],
    'request',
    { runId: RUN_ID },
    { expectedEpoch: 0, runId: RUN_ID, actorId: 'attacker' },
    { runId: RUN_ID, expectedEpoch: -1 },
    { runId: RUN_ID, expectedEpoch: 1.5 },
    { runId: RUN_ID, expectedEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { runId: 'not-a-uuid', expectedEpoch: 0 },
  ])('rejects unsafe envelope %j', (value) => {
    expect(parseRunControlLeaseRequest(value)).toBeNull();
  });
});

describe('run-control-lease commands', () => {
  it('acquires epoch one from the never-created state using server transaction time', async () => {
    const test = harness();
    const result = await acquireRunControlLease(test.dependencies, { session: SESSION_A, request: request(0) });

    expect(result).toEqual({
      ok: true,
      operation: 'acquire',
      lease: {
        runId: RUN_ID,
        epoch: 1,
        holderId: SESSION_A.userId,
        expiresAt: '2026-09-19T10:02:00.000Z',
        updatedAt: AT,
      },
    });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]).toMatchObject({
      eventType: RUN_CONTROL_LEASE_ACQUIRED_EVENT,
      actor: { type: 'human', id: SESSION_A.userId },
      sessionId: SESSION_A.sessionId,
      payload: {
        operation: 'acquire', priorEpoch: 0, epoch: 1, priorHolderId: null,
        holderId: SESSION_A.userId, expiresAt: '2026-09-19T10:02:00.000Z', updatedAt: AT,
      },
    });
    expect(test.operations).toEqual(['save', 'audit', 'notify']);
    expect(test.notifications).toEqual([1]);
  });

  it('requires the server enrollment flag only for a missing row, while released rows remain controllable', async () => {
    const disabled = harness({ allowEnrollment: false });
    await expect(acquireRunControlLease(disabled.dependencies, { session: SESSION_A, request: request(0) })).resolves.toEqual({
      ok: false,
      code: 'disabled',
      reason: RUN_CONTROL_LEASE_REFUSALS.disabled,
    });
    expect(disabled.saved).toEqual([]);

    const enrolled = harness({ allowEnrollment: false, state: lease({ epoch: 2, holderId: null, expiresAt: null }) });
    const result = await acquireRunControlLease(enrolled.dependencies, { session: SESSION_A, request: request(2) });
    expect(result.ok).toBe(true);
    expect(result.ok && result.lease.epoch).toBe(3);
  });

  it('does not open a transaction for malformed input and never accepts a client actor id', async () => {
    const test = harness();
    const result = await acquireRunControlLease(test.dependencies, {
      session: SESSION_A,
      request: { runId: RUN_ID, expectedEpoch: 0, actorId: SESSION_B.userId },
    });
    expect(result).toEqual({ ok: false, code: 'malformed', reason: RUN_CONTROL_LEASE_REFUSALS.malformed });
    expect(test.transactionRunIds).toEqual([]);
    expect(test.events).toEqual([]);
  });

  it('checks run.resume before the transaction and audits an authorization refusal', async () => {
    const test = harness({ role: 'poc-administrator' });
    const result = await acquireRunControlLease(test.dependencies, { session: SESSION_A, request: request(0) });

    expect(result).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(test.transactionRunIds).toEqual([]);
    expect(test.denials).toHaveLength(1);
    expect(test.denials[0]).toMatchObject({
      eventType: 'security.denied',
      sessionId: SESSION_A.sessionId,
      payload: { action: 'run.resume' },
    });
  });

  it('rechecks run.resume after the Run lock and audits a revocation without changing the lease', async () => {
    const test = harness({ lockedRole: null });
    const result = await acquireRunControlLease(test.dependencies, { session: SESSION_A, request: request(0) });

    expect(result).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(test.transactionRunIds).toEqual([RUN_ID]);
    expect(test.saved).toEqual([]);
    expect(test.events).toEqual([]);
    expect(test.denials).toHaveLength(1);
  });

  it('refuses a live lease held by another actor and does not overwrite it', async () => {
    const prior = lease();
    const test = harness({ state: prior });
    const result = await acquireRunControlLease(test.dependencies, { session: SESSION_B, request: request(1) });

    expect(result).toEqual({ ok: false, code: 'held', reason: RUN_CONTROL_LEASE_REFUSALS.held });
    expect(test.currentState()).toEqual(prior);
    expect(test.saved).toEqual([]);
    expect(test.events).toEqual([]);
  });

  it('renews only the live same-holder epoch and keeps the epoch stable', async () => {
    const test = harness({ state: lease(), now: '2026-09-19T10:01:00.000Z' });
    const result = await renewRunControlLease(test.dependencies, { session: SESSION_A, request: renewal(1) });

    expect(result).toEqual({
      ok: true,
      operation: 'renew',
      receipt: { requestKey: REQUEST_KEY, expectedEpoch: 1, eventId: expect.any(String), sequence: 1 },
      lease: {
        runId: RUN_ID,
        epoch: 1,
        holderId: SESSION_A.userId,
        expiresAt: '2026-09-19T10:03:00.000Z',
        updatedAt: '2026-09-19T10:01:00.000Z',
      },
    });
    expect(test.events[0]).toMatchObject({ eventType: RUN_CONTROL_LEASE_RENEWED_EVENT, payload: { priorEpoch: 1, epoch: 1 } });
  });

  it.each(['renew', 'release'] as const)('materializes expiry and refuses %s at the exact deadline', async (operation) => {
    const test = harness({ state: lease(), now: '2026-09-19T10:02:00.000Z' });
    const run = operation === 'renew'
      ? renewRunControlLease(test.dependencies, { session: SESSION_A, request: renewal(1) })
      : releaseRunControlLease(test.dependencies, { session: SESSION_A, request: request(1) });
    await expect(run).resolves.toEqual({ ok: false, code: 'expired', reason: RUN_CONTROL_LEASE_REFUSALS.expired });
    expect(test.currentState()).toEqual({
      runId: RUN_ID,
      epoch: 2,
      holderId: null,
      expiresAt: null,
      updatedAt: '2026-09-19T10:02:00.000Z',
    });
    expect(test.events).toHaveLength(1);
    expect(test.events[0]).toMatchObject({
      eventType: RUN_CONTROL_LEASE_EXPIRED_EVENT,
      actor: { type: 'system', id: 'run-control-lease-observer' },
      payload: { priorEpoch: 1, epoch: 2, priorHolderId: SESSION_A.userId, holderId: null, observedBy: SESSION_A.userId },
    });
  });

  it('records expiry before reacquisition, so expiry and the new holder have distinct epochs and events', async () => {
    const test = harness({ state: lease({ expiresAt: '2026-09-19T09:59:59.000Z' }) });
    const result = await acquireRunControlLease(test.dependencies, { session: SESSION_B, request: request(1) });

    expect(result).toMatchObject({ ok: true, operation: 'acquire', lease: { epoch: 3, holderId: SESSION_B.userId } });
    expect(test.events.map((event) => event.eventType)).toEqual([
      RUN_CONTROL_LEASE_EXPIRED_EVENT,
      RUN_CONTROL_LEASE_ACQUIRED_EVENT,
    ]);
    expect(test.events[0]?.payload).toMatchObject({ priorEpoch: 1, epoch: 2, priorHolderId: SESSION_A.userId, holderId: null });
    expect(test.events[1]?.payload).toMatchObject({ priorEpoch: 2, epoch: 3, priorHolderId: null, holderId: SESSION_B.userId });
  });

  it('rejects an old same-actor tab after expiry materialization and reacquisition', async () => {
    const test = harness({ state: lease({ expiresAt: '2026-09-19T09:59:59.000Z' }) });
    await acquireRunControlLease(test.dependencies, { session: SESSION_A, request: request(1) });

    const stale = await renewRunControlLease(test.dependencies, { session: SESSION_A, request: renewal(1) });
    expect(stale).toEqual({ ok: false, code: 'stale-epoch', reason: RUN_CONTROL_LEASE_REFUSALS.staleEpoch });
  });

  it('releases voluntarily by advancing the epoch and retaining an empty durable row', async () => {
    const test = harness({ state: lease() });
    const result = await releaseRunControlLease(test.dependencies, { session: SESSION_A, request: request(1) });

    expect(result).toEqual({
      ok: true,
      operation: 'release',
      lease: { runId: RUN_ID, epoch: 2, holderId: null, expiresAt: null, updatedAt: AT },
    });
    expect(test.events[0]).toMatchObject({ eventType: RUN_CONTROL_LEASE_RELEASED_EVENT, payload: { priorEpoch: 1, epoch: 2, priorHolderId: SESSION_A.userId, holderId: null } });
    expect(test.currentState()).not.toBeNull();
  });

  it('denies wrong owner, stale epoch and no-current-lease operations without mutation', async () => {
    const wrongOwner = harness({ state: lease() });
    await expect(renewRunControlLease(wrongOwner.dependencies, { session: SESSION_B, request: renewal(1) })).resolves.toMatchObject({ code: 'not-owner' });
    await expect(releaseRunControlLease(wrongOwner.dependencies, { session: SESSION_A, request: request(0) })).resolves.toMatchObject({ code: 'stale-epoch' });
    expect(wrongOwner.saved).toEqual([]);

    const noLease = harness({ state: lease({ epoch: 2, holderId: null, expiresAt: null }) });
    await expect(renewRunControlLease(noLease.dependencies, { session: SESSION_A, request: renewal(2) })).resolves.toEqual({
      ok: false,
      code: 'no-lease',
      reason: RUN_CONTROL_LEASE_REFUSALS.noLease,
    });
    expect(noLease.saved).toEqual([]);
  });

  it('refuses a terminal Run before reading or writing a lease', async () => {
    const test = harness({ run: runRecord('COMPLETED') });
    const result = await acquireRunControlLease(test.dependencies, { session: SESSION_A, request: request(0) });

    expect(result).toEqual({ ok: false, code: 'terminal', reason: RUN_CONTROL_LEASE_REFUSALS.terminal });
    expect(test.saved).toEqual([]);
    expect(test.events).toEqual([]);
  });

  it('returns an honest missing-Run refusal and does not create a lease row', async () => {
    const test = harness({ run: null });
    const result = await acquireRunControlLease(test.dependencies, { session: SESSION_A, request: request(0, OTHER_RUN_ID) });

    expect(result).toEqual({ ok: false, code: 'unknown', reason: RUN_CONTROL_LEASE_REFUSALS.unknown });
    expect(test.saved).toEqual([]);
  });

  it('serializes concurrent acquisitions through the repository transaction and lets only one holder win', async () => {
    const test = harness();
    const [first, second] = await Promise.all([
      acquireRunControlLease(test.dependencies, { session: SESSION_A, request: request(0) }),
      acquireRunControlLease(test.dependencies, { session: SESSION_B, request: request(1) }),
    ]);

    expect(first).toMatchObject({ ok: true, lease: { epoch: 1, holderId: SESSION_A.userId } });
    expect(second).toEqual({ ok: false, code: 'held', reason: RUN_CONTROL_LEASE_REFUSALS.held });
    expect(test.saved).toHaveLength(1);
    expect(test.events).toHaveLength(1);
  });
  it('recovers the exact event before epoch admission, including after release/reacquisition', async () => {
    const test = harness({ state: lease() });
    const input = { session: SESSION_A, request: renewal(1) };
    const [first, duplicate] = await Promise.all([
      renewRunControlLease(test.dependencies, input), renewRunControlLease(test.dependencies, input),
    ]);
    expect(duplicate).toEqual(first);
    expect(test.events).toHaveLength(1);
    await releaseRunControlLease(test.dependencies, { session: SESSION_A, request: request(1) });
    await acquireRunControlLease(test.dependencies, { session: SESSION_B, request: request(2) });
    expect(await renewRunControlLease(test.dependencies, input)).toEqual(first);
    expect(test.currentState()).toMatchObject({ epoch: 3, holderId: SESSION_B.userId });
    expect(await renewRunControlLease(test.dependencies, { ...input, request: renewal(3) })).toMatchObject({ code: 'conflict' });
    expect(test.events).toHaveLength(3);
  });

  it('requires a UUID renewal key and rejects it on other operations', () => {
    expect(parseRunControlLeaseRequest(request(1), 'renew')).toBeNull();
    expect(parseRunControlLeaseRequest({ ...renewal(1), requestKey: 'invalid' }, 'renew')).toBeNull();
    expect(parseRunControlLeaseRequest(renewal(1), 'release')).toBeNull();
    expect(parseRunControlLeaseRequest(renewal(1), 'acquire')).toBeNull();
    expect(parseRunControlLeaseRequest(renewal(1), 'renew')).toEqual(renewal(1));
  });

  it.each<Record<string, string | number>>([
    { epoch: 2 }, { expectedEpoch: '1' }, { holderId: SESSION_B.userId },
    { expiresAt: '2026-09-19T10:03:00.000Z' }, { requestKey: 'invalid' }, { extra: 'ignored?' },
  ])('refuses corrupt retained renewal payload %j rather than synthesizing success', async patch => {
    const test = harness({ state: lease() });
    const input = { session: SESSION_A, request: renewal(1) };
    await renewRunControlLease(test.dependencies, input);
    const repository = test.dependencies.repository;
    const dependencies = { ...test.dependencies, repository: {
      transaction: <T>(runId: string, work: (context: RunControlLeaseContext) => Promise<T>) => repository.transaction(runId,
        context => work({ ...context, readRenewalEvent: async (actorId, key) => {
          const event = await context.readRenewalEvent(actorId, key);
          return event === null ? null : { ...event, payload: { ...event.payload, ...patch } };
        } })),
    } };
    await expect(renewRunControlLease(dependencies, input)).rejects.toThrow('Invalid retained controller renewal receipt');
    expect(test.events).toHaveLength(1);
  });

});
