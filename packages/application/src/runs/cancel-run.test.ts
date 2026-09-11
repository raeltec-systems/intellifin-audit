import { describe, expect, it } from 'vitest';
import {
  RUN_CANCELED_DEFAULT_REASON,
  RUN_CANCEL_REFUSALS,
  RUN_STATES,
  isActiveRunState,
  type PackageArtifact,
  type RunCancellationRequest,
  type RunRecord,
  type RunResultConditionCount,
  type RunResultExclusion,
  type RunResultFindings, type RunPauseRequest } from '@intellifin/domain';
import { cancelRun, CANCEL_REQUEST_MALFORMED, type CancelRunDependencies } from './cancel-run.js';
import type { GateCheckRow, PackageSeal, RunGatePopulationFacts, StoredRunResult, WithdrawnWait } from './execution-ports.js';
import type { RunCancellationContext } from './ports.js';

/**
 * `CancelRun` over a fake transaction.
 *
 * `tests/integration/cancel-run.test.ts` drives it against a real PostgreSQL, including
 * the held-open race against a worker claim. What is pinned HERE is the decision: which
 * side performs the transition, that a queued Run's dispatch job goes in the same unit,
 * that a duplicate writes nothing twice, and that a terminal Run and a revoked role are
 * refused before anything is written.
 */

const RUN: RunRecord = {
  runId: '01a06fd8-0000-7000-8000-0000000000c1',
  correlationId: '01a06fd8-0000-7000-8000-0000000000c2',
  procedureId: '01a06fd8-0000-7000-8000-0000000000c3',
  versionId: '01a06fd8-0000-7000-8000-0000000000c4',
  versionNumber: 1,
  procedureName: 'High-value approvals',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'QUEUED',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-02T00:00:00.000Z',
  authorizationRole: 'auditor',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null, pauseRequest: null,
  requestToken: '01a06fd8-0000-7000-8000-0000000000c5',
};

const SESSION = { userId: 'auditor', sessionId: 'browser-session' };
const NOW = new Date('2026-09-06T09:00:00.000Z');
const NO_FINDINGS: RunResultFindings = { total: 0, records: [] };

class FakeContext implements RunCancellationContext {
  run: RunRecord | null;
  marker: RunCancellationRequest | null = null;
  dispatchRemovals = 0;
  states: RunRecord['state'][] = [];
  events: { eventType: string; actor: string; sessionId: string; payload: Record<string, unknown> }[] = [];
  result: StoredRunResult | null = null;
  seal: PackageSeal | null = null;
  role: string | null;
  private sequence = 0;

  constructor(run: RunRecord | null, role: string | null = 'auditor') {
    this.run = run;
    this.role = role;
  }

  authorizationRoles = { findRole: async (): Promise<never> => this.role as never };
  auditEvents = {
    append: async (draft: { eventType: string; actor: { id: string }; sessionId: string; payload: Record<string, unknown> }) => {
      this.sequence += 1;
      this.events.push({ eventType: draft.eventType, actor: draft.actor.id, sessionId: draft.sessionId, payload: draft.payload });
      return { sequence: this.sequence } as never;
    },
  };
  frozenPlan = async () => null;
  requestCancellation = async (request: RunCancellationRequest): Promise<void> => {
    this.marker = request;
    if (this.run) this.run = { ...this.run, cancellation: request };
  };
  removeDispatch = async (): Promise<void> => {
    this.dispatchRemovals += 1;
  };
  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => [];
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => this.seal;
  writeSeal = async (seal: PackageSeal): Promise<void> => {
    this.seal = seal;
  };
  notifyTimeline = async (): Promise<void> => undefined;
  readGateChecks = async (): Promise<readonly GateCheckRow[]> => [];
  // What the terminal transaction sees, which `requestCancellation` has already written.
  readCancellation = async (): Promise<RunCancellationRequest | null> => this.marker;
  readPauseRequest = async (): Promise<RunPauseRequest | null> => this.pauseRequest ?? null;
  /** Generation 47: what a terminal transition withdraws, set by a test that opens one. */
  openWait: WithdrawnWait | null = null;
  withdrawnAt: string | null = null;
  withdrawOpenWait = async (at: string): Promise<WithdrawnWait | null> => {
    const wait = this.openWait;
    if (wait === null) return null;
    this.openWait = null;
    this.withdrawnAt = at;
    return wait;
  };
  pauseRequest: RunPauseRequest | null = null;
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    this.states.push(state);
  };
  readPopulationFacts = async (): Promise<RunGatePopulationFacts | null> => null;
  /** Story 5.2: no Tool Action left a frame gap unless a case says otherwise. */
  readMissingFrames = async () => ({ total: 0, sample: [] });
  readPopulationRows = async () => [];
  readGateObservations = async () => [];
  readResult = async (): Promise<StoredRunResult | null> => this.result;
  writeResult = async (result: StoredRunResult): Promise<void> => {
    this.result = result;
  };
  readResultExclusions = async (): Promise<readonly RunResultExclusion[]> => [];
  readConditionCounts = async (): Promise<readonly RunResultConditionCount[]> => [];
  readResultFindings = async () => ({ exceptions: NO_FINDINGS, unevaluated: NO_FINDINGS });
}

function dependencies(context: FakeContext, denials: unknown[] = []): CancelRunDependencies {
  let next = 0;
  return {
    roles: { findRole: async () => context.role as never },
    unitOfWork: {
      execute: (work: (unit: never) => Promise<unknown>) =>
        work({ auditEvents: { append: async (draft: unknown) => { denials.push(draft); return { sequence: 0 }; } } } as never) as never,
    } as never,
    repository: { transaction: (_runId: string, work: (unit: RunCancellationContext) => Promise<unknown>) => work(context) as never },
    ids: { next: () => `01a06fd8-0000-7000-8000-00000000${String(10 + (next += 1))}` },
    clock: { now: () => NOW },
  };
}

describe('cancelRun', () => {
  it('finishes the job itself for a queued Run: state, marker, dispatch and Result in one unit', async () => {
    const context = new FakeContext(RUN);
    expect(await cancelRun(dependencies(context), { session: SESSION, request: { runId: RUN.runId, reason: null } }))
      .toEqual({ ok: true, state: 'CANCELED', pending: false });
    expect(context.states).toEqual(['CANCELED']);
    expect(context.dispatchRemovals).toBe(1);
    expect(context.marker).toEqual({ requestedBy: 'auditor', sessionId: 'browser-session', requestedAt: NOW.toISOString(), reason: RUN_CANCELED_DEFAULT_REASON });
    // A cancellation IS a terminal transition, so the Result exists and its outcome is
    // the §E.1 row reserved for it. The Gate never ran and the Result says so.
    expect(context.result).toMatchObject({ outcome: 'CANCELED', row: 'canceled', sealed: true, runState: 'CANCELED', gatePassed: false });
    expect(context.result?.publication.gate).toEqual({ passed: false, checks: 0, failed: [] });
    expect(context.seal).toMatchObject({ runState: 'CANCELED' });
    expect(context.events.map(event => event.eventType)).toEqual(['lifecycle.run-canceled', 'lifecycle.evidence-package-sealed', 'lifecycle.result-sealed']);
    // The actor is the person who cancelled and the session is the one they asked from,
    // never the initiator's, which is what the Run row would have supplied.
    expect(context.events[0]).toMatchObject({ actor: 'auditor', sessionId: 'browser-session', payload: { priorState: 'QUEUED', state: 'CANCELED', performedBy: 'web' } });
  });

  it('records a request and performs nothing for a Run a worker is executing', async () => {
    const context = new FakeContext({ ...RUN, state: 'RUNNING' });
    expect(await cancelRun(dependencies(context), { session: SESSION, request: { runId: RUN.runId, reason: 'Wrong period.' } }))
      .toEqual({ ok: true, state: 'RUNNING', pending: true });
    expect(context.states).toEqual([]);
    expect(context.dispatchRemovals).toBe(0);
    expect(context.result).toBeNull();
    expect(context.seal).toBeNull();
    expect(context.marker?.reason).toBe('Wrong period.');
    expect(context.events.map(event => event.eventType)).toEqual(['lifecycle.run-cancel-requested']);
    expect(context.events[0]?.payload).toMatchObject({ state: 'RUNNING', performedBy: 'worker' });
  });

  it('is idempotent: a second cancellation writes no marker, no state and no event', async () => {
    const existing: RunCancellationRequest = { requestedBy: 'first', sessionId: 'first-session', requestedAt: '2026-09-06T08:00:00.000Z', reason: 'Wrong period.' };
    const context = new FakeContext({ ...RUN, state: 'RUNNING', cancellation: existing });
    expect(await cancelRun(dependencies(context), { session: { userId: 'second', sessionId: 'second-session' }, request: { runId: RUN.runId, reason: 'Different note.' } }))
      .toEqual({ ok: true, state: 'RUNNING', pending: true });
    expect(context.marker).toBeNull();
    expect(context.events).toEqual([]);
    expect(context.states).toEqual([]);
  });

  it('cancels from every active state and refuses every terminal one, on the domain table', async () => {
    for (const state of RUN_STATES) {
      const context = new FakeContext({ ...RUN, state });
      const outcome = await cancelRun(dependencies(context), { session: SESSION, request: { runId: RUN.runId, reason: null } });
      if (!isActiveRunState(state)) {
        expect(outcome).toEqual({ ok: false, reason: RUN_CANCEL_REFUSALS.ALREADY_TERMINAL });
        // A refusal writes nothing at all: state, marker, dispatch, Result and chain.
        expect([context.states.length, context.marker, context.dispatchRemovals, context.result, context.events.length]).toEqual([0, null, 0, null, 0]);
        continue;
      }
      expect(outcome).toMatchObject({ ok: true, pending: state === 'RUNNING', state: state === 'RUNNING' ? 'RUNNING' : 'CANCELED' });
      // Only RUNNING is held by a worker; the other three are finished here.
      expect(context.states).toEqual(state === 'RUNNING' ? [] : ['CANCELED']);
      expect(context.dispatchRemovals).toBe(state === 'RUNNING' ? 0 : 1);
    }
  });

  it('refuses a Run that does not exist without writing anything', async () => {
    const context = new FakeContext(null);
    expect(await cancelRun(dependencies(context), { session: SESSION, request: { runId: RUN.runId, reason: null } }))
      .toEqual({ ok: false, reason: RUN_CANCEL_REFUSALS.UNKNOWN });
    expect(context.events).toEqual([]);
  });

  it('refuses hostile input by shape and bound before opening a transaction', async () => {
    const context = new FakeContext(RUN);
    const hostile: unknown[] = [
      null,
      [],
      'run',
      {},
      { runId: RUN.runId },
      { runId: RUN.runId, reason: null, extra: 'forged' },
      { runId: 'not-a-run', reason: null },
      { runId: RUN.runId, reason: 42 },
      { runId: RUN.runId, reason: '   ' },
      { runId: RUN.runId, reason: 'x'.repeat(501) },
    ];
    for (const request of hostile) {
      expect(await cancelRun(dependencies(context), { session: SESSION, request })).toEqual({ ok: false, reason: CANCEL_REQUEST_MALFORMED });
    }
    expect([context.states.length, context.marker, context.dispatchRemovals, context.events.length]).toEqual([0, null, 0, 0]);
  });

  it('rechecks the role after the lock, audits the actual refusal and writes nothing', async () => {
    const context = new FakeContext(RUN, 'auditor');
    const denials: unknown[] = [];
    const deps = dependencies(context, denials);
    // The pool read allows; the row lock finds the role revoked.
    const revoked: CancelRunDependencies = { ...deps, roles: { findRole: async () => 'auditor' as never } };
    context.role = null;
    const outcome = await cancelRun(revoked, { session: SESSION, request: { runId: RUN.runId, reason: null } });
    expect(outcome).toMatchObject({ ok: false });
    expect([context.states.length, context.marker, context.dispatchRemovals, context.events.length]).toEqual([0, null, 0, 0]);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ eventType: 'security.denied', outcome: 'denied', payload: { action: 'run.cancel', role: null } });
  });
});
