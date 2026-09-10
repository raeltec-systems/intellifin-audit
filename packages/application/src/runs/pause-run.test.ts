import { describe, expect, it } from 'vitest';
import {
  RUN_PAUSE_REFUSALS,
  RUN_PAUSE_TRANSITIONS,
  RUN_RESUME_REFUSALS,
  RUN_STATES,
  runPauseTransition,
  type RunCancellationRequest,
  type RunPauseRequest,
  type RunRecord,
  type RunResultConditionCount,
  type RunResultExclusion,
  type RunResultFindings,
  type PackageArtifact,
} from '@intellifin/domain';
import {
  PAUSED_TIMEOUT_MS,
  PAUSE_OPTIONS,
  waitClosureKindFor,
  waitRunState,
  type RunWait,
  type VersionedRun,
  type WaitContext,
  type WaitOperation,
  type WaitRepository,
} from './waits.js';
import { pauseRun, pauseWaitFor, performPause, resumeRun } from './pause-run.js';
import type { GateCheckRow, PackageSeal, RunGatePopulationFacts, StoredRunResult } from './execution-ports.js';

/**
 * `PauseRun` and `ResumeRun` (Story 5.4).
 *
 * The fake is kind-aware exactly as the real repository is — an Escalation holds the Run
 * in `AWAITING_AUDITOR`, a pause in `PAUSED`, and each closes by its own kind's closure —
 * because a fake that hard-coded one would let a pause test pass against a build that put
 * the Run in the wrong state, which is the whole thing these tests are for.
 */

const RUN_ID = '01a06fd8-0000-7000-8000-0000000000b1';
const NOW = new Date('2026-09-10T09:00:00.000Z');
const SESSION = { userId: 'auditor', sessionId: 'session' } as const;

const RUN: VersionedRun = {
  runId: RUN_ID,
  correlationId: '01a06fd8-0000-7000-8000-0000000000b3',
  procedureId: '01a06fd8-0000-7000-8000-0000000000b4',
  versionId: '01a06fd8-0000-7000-8000-0000000000b5',
  versionNumber: 1,
  procedureName: 'Terminated users',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: SESSION.userId,
  sessionId: SESSION.sessionId,
  initiatedAt: '2026-09-10T08:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01a06fd8-0000-7000-8000-0000000000b6',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null,
  pauseRequest: null,
  revision: 3,
};

const NO_FINDINGS: RunResultFindings = { total: 0, records: [] };

class FakeWaitContext implements WaitContext {
  run: VersionedRun | null;
  wait: RunWait | null = null;
  role: 'auditor' | 'audit-manager' | 'poc-administrator' | null = 'auditor';
  result: StoredRunResult | null = null;
  seal: PackageSeal | null = null;
  events: { eventType: string; payload: Record<string, unknown>; actorId: string }[] = [];
  pauseRequest: RunPauseRequest | null = null;
  private sequence = 0;

  constructor(run: VersionedRun = RUN) {
    this.run = { ...run };
    this.pauseRequest = run.pauseRequest;
  }

  authorizationRoles = { findRole: async (): Promise<typeof this.role> => this.role };
  readWait = async (waitId: string): Promise<RunWait | null> => (this.wait?.waitId === waitId ? this.wait : null);
  readEscalationDetails = async (): Promise<null> => null;
  auditEvents = {
    append: async (draft: { eventType: string; payload: Record<string, unknown>; actor: { id: string } }) => {
      this.sequence += 1;
      this.events.push({ eventType: draft.eventType, payload: draft.payload, actorId: draft.actor.id });
      return { sequence: this.sequence } as never;
    },
  };

  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => [];
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => this.seal;
  writeSeal = async (seal: PackageSeal): Promise<void> => { this.seal = seal; };
  notifyTimeline = async (): Promise<void> => undefined;
  readGateChecks = async (): Promise<readonly GateCheckRow[]> => [];
  readCancellation = async (): Promise<RunCancellationRequest | null> => this.run?.cancellation ?? null;
  readPauseRequest = async (): Promise<RunPauseRequest | null> => this.pauseRequest;
  requestPause = async (request: RunPauseRequest): Promise<void> => {
    if (this.pauseRequest !== null) return; // The FIRST request wins, as in the repository.
    this.pauseRequest = request;
    if (this.run) this.run = { ...this.run, pauseRequest: request };
  };
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    if (this.run && this.run.state !== state) this.run = { ...this.run, state, revision: this.run.revision + 1 };
  };
  requestCancellation = async (request: RunCancellationRequest): Promise<void> => {
    if (this.run) this.run = { ...this.run, cancellation: request };
  };
  readPopulationFacts = async (): Promise<RunGatePopulationFacts | null> => null;
  readMissingFrames = async () => ({ total: 0, sample: [] });
  readPopulationRows = async () => [];
  readGateObservations = async () => [];
  readResult = async (): Promise<StoredRunResult | null> => this.result;
  writeResult = async (result: StoredRunResult): Promise<void> => { this.result = result; };
  readResultExclusions = async (): Promise<readonly RunResultExclusion[]> => [];
  readConditionCounts = async (): Promise<readonly RunResultConditionCount[]> => [];
  readResultFindings = async () => ({ exceptions: NO_FINDINGS, unevaluated: NO_FINDINGS });
  frozenPlan = async () => null;

  async createWait(wait: RunWait): Promise<WaitOperation> {
    if (!this.run) return { outcome: 'missing', wait: null, run: null };
    if (this.run.state !== 'RUNNING') return { outcome: 'not-running', wait: this.wait, run: this.run };
    if (this.wait) return { outcome: 'already-open', wait: this.wait, run: this.run };
    this.run = { ...this.run, state: waitRunState(wait.kind), revision: this.run.revision + 1 };
    this.wait = wait;
    return { outcome: 'created', wait, run: this.run };
  }

  async closeWait(input: { waitId: string; expectedRunRevision: number; answerOptionId: string; actor: string; now: string; stateAfterClose: 'RUNNING' | 'AWAITING_AUDITOR' }): Promise<WaitOperation> {
    if (!this.run || !this.wait || this.wait.waitId !== input.waitId) return { outcome: 'missing', wait: null, run: this.run };
    if (this.wait.closedAt !== null) return { outcome: 'superseded', wait: this.wait, run: this.run };
    if (this.run.state !== waitRunState(this.wait.kind)) return { outcome: 'not-awaiting', wait: this.wait, run: this.run };
    if (this.run.revision !== input.expectedRunRevision) return { outcome: 'stale-revision', wait: this.wait, run: this.run };
    if (Date.parse(input.now) >= Date.parse(this.wait.deadline)) return { outcome: 'expired', wait: this.wait, run: this.run };
    if (!this.wait.options.some((option) => option.id === input.answerOptionId)) return { outcome: 'expired', wait: this.wait, run: this.run };
    this.wait = { ...this.wait, closedAt: input.now, closureKind: waitClosureKindFor(this.wait.kind), answerOptionId: input.answerOptionId, actor: input.actor };
    this.run = { ...this.run, state: input.stateAfterClose, revision: this.run.revision + 1 };
    return { outcome: 'closed', wait: this.wait, run: this.run };
  }

  async timeoutWait(): Promise<WaitOperation> {
    return { outcome: 'missing', wait: null, run: this.run };
  }
}

class FakeWaitRepository implements WaitRepository {
  constructor(readonly context = new FakeWaitContext()) {}
  async transaction<T>(_runId: string, work: (context: WaitContext) => Promise<T>): Promise<T> {
    return work(this.context);
  }
  async recoverableWaits(): Promise<readonly { waitId: string; runId: string }[]> {
    return [];
  }
}

function ids(): { next(): string } {
  let count = 20;
  return { next: () => `01a06fd8-0000-7000-8000-${String(count++).padStart(12, '0')}` };
}

function dependencies(repository: WaitRepository, clock: { now(): Date } = { now: () => NOW }) {
  return {
    repository,
    roles: { findRole: async () => 'auditor' as const },
    unitOfWork: { execute: async () => undefined } as never,
    ids: ids(),
    clock,
  };
}

describe('the pause transition table', () => {
  it('permits exactly one transition, and the worker performs it', () => {
    expect(RUN_PAUSE_TRANSITIONS).toEqual([{ from: 'RUNNING', to: 'PAUSED', performedBy: 'worker' }]);
  });

  /**
   * Total over the vocabulary, and refusing everything else BY the table rather than by a
   * condition somewhere that could be edited to admit a state the contract does not.
   */
  it('refuses every other Run state', () => {
    for (const state of RUN_STATES) {
      expect(runPauseTransition(state) === null).toBe(state !== 'RUNNING');
    }
  });

  /** A plain object index would answer with an inherited function. Seventh occurrence. */
  it('is walked, never indexed by request input', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(runPauseTransition(key)).toBeNull();
    }
  });
});

describe('the pause wait', () => {
  const request: RunPauseRequest = { requestedBy: 'auditor', sessionId: 'session', requestedAt: '2026-09-10T08:59:00.000Z' };

  it('is thirty minutes from when the pause TOOK EFFECT, not from the request', () => {
    const wait = pauseWaitFor({ waitId: 'w', runId: RUN_ID, request, at: NOW.toISOString() });
    expect(wait.openedAt).toBe(NOW.toISOString());
    expect(Date.parse(wait.deadline) - NOW.getTime()).toBe(PAUSED_TIMEOUT_MS);
    expect(PAUSED_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it('names the auditor who asked for it and carries the one Resume option', () => {
    const wait = pauseWaitFor({ waitId: 'w', runId: RUN_ID, request, at: NOW.toISOString() });
    expect(wait.openedBy).toBe('auditor');
    expect(wait.kind).toBe('pause');
    expect(wait.options).toEqual(PAUSE_OPTIONS);
    expect(wait.options.map((option) => option.id)).toEqual(['resume']);
  });
});

describe('PauseRun', () => {
  it('records the request and leaves the Run RUNNING for its worker to stop', async () => {
    const repository = new FakeWaitRepository();
    const outcome = await pauseRun(dependencies(repository), { session: SESSION, request: { runId: RUN_ID } });

    expect(outcome).toEqual({ ok: true, state: 'RUNNING', pending: true });
    expect(repository.context.run?.state).toBe('RUNNING');
    expect(repository.context.pauseRequest).toEqual({
      requestedBy: 'auditor',
      sessionId: 'session',
      requestedAt: NOW.toISOString(),
    });
    // The request, not the transition. The worker's own event records that.
    expect(repository.context.events.map((event) => event.eventType)).toEqual(['lifecycle.run-pause-requested']);
    expect(repository.context.wait).toBeNull();
  });

  it('is idempotent: a second request never overwrites the first requester or time', async () => {
    const repository = new FakeWaitRepository();
    await pauseRun(dependencies(repository), { session: SESSION, request: { runId: RUN_ID } });
    const second = await pauseRun(
      dependencies(repository, { now: () => new Date('2026-09-10T09:05:00.000Z') }),
      { session: { userId: 'somebody-else', sessionId: 'other' }, request: { runId: RUN_ID } },
    );

    expect(second).toEqual({ ok: true, state: 'RUNNING', pending: true });
    expect(repository.context.pauseRequest?.requestedBy).toBe('auditor');
    expect(repository.context.pauseRequest?.requestedAt).toBe(NOW.toISOString());
    expect(repository.context.events).toHaveLength(1);
  });

  it("refuses an Awaiting Auditor Run with the contract's own sentence", async () => {
    const repository = new FakeWaitRepository(new FakeWaitContext({ ...RUN, state: 'AWAITING_AUDITOR' }));
    await expect(pauseRun(dependencies(repository), { session: SESSION, request: { runId: RUN_ID } }))
      .resolves.toEqual({ ok: false, reason: RUN_PAUSE_REFUSALS.AWAITING });
    expect(repository.context.events).toHaveLength(0);
    expect(repository.context.pauseRequest).toBeNull();
  });

  it('refuses every other non-Running state, writing nothing', async () => {
    for (const state of ['QUEUED', 'PAUSED', 'COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED'] as const) {
      const repository = new FakeWaitRepository(new FakeWaitContext({ ...RUN, state }));
      await expect(pauseRun(dependencies(repository), { session: SESSION, request: { runId: RUN_ID } }))
        .resolves.toEqual({ ok: false, reason: RUN_PAUSE_REFUSALS.NOT_RUNNING });
      expect(repository.context.events).toHaveLength(0);
      expect(repository.context.pauseRequest).toBeNull();
    }
  });

  it('refuses a malformed request before it reads a Run', async () => {
    const repository = new FakeWaitRepository();
    for (const request of [null, [], { runId: 'not-a-uuid' }, { runId: RUN_ID, extra: 1 }, {}]) {
      const outcome = await pauseRun(dependencies(repository), { session: SESSION, request });
      expect(outcome.ok).toBe(false);
    }
    expect(repository.context.events).toHaveLength(0);
  });
});

describe('performPause', () => {
  it('opens the wait, clears the marker and records who paused it', async () => {
    const context = new FakeWaitContext({ ...RUN, state: 'PAUSED' });
    const opened: RunWait[] = [];
    const request: RunPauseRequest = { requestedBy: 'auditor', sessionId: 'session', requestedAt: '2026-09-10T08:59:00.000Z' };
    context.pauseRequest = request;
    const withPause = Object.assign(context, {
      openPauseWait: async (wait: RunWait) => { opened.push(wait); context.wait = wait; },
      clearPauseRequest: async () => { context.pauseRequest = null; },
    });

    const wait = await performPause(withPause, {
      run: { ...RUN, state: 'RUNNING' },
      request,
      waitId: '01a06fd8-0000-7000-8000-0000000000c1',
      at: NOW.toISOString(),
      stepExecutionId: 'step-execution',
      workItemId: 'work-item',
    });

    expect(opened).toEqual([wait]);
    expect(wait.kind).toBe('pause');
    // Cleared HERE, which is what makes a marker still present at a terminal transition
    // mean exactly `lifecycle.pause-superseded` with no state comparison.
    expect(context.pauseRequest).toBeNull();
    const [event] = context.events;
    expect(event?.eventType).toBe('lifecycle.run-paused');
    // A person paused it, whichever process performed the transition.
    expect(event?.actorId).toBe('auditor');
    expect(event?.payload).toMatchObject({
      priorState: 'RUNNING',
      state: 'PAUSED',
      waitId: wait.waitId,
      deadline: wait.deadline,
      stepExecutionId: 'step-execution',
      workItemId: 'work-item',
    });
  });
});

describe('ResumeRun', () => {
  async function paused(): Promise<FakeWaitRepository> {
    const context = new FakeWaitContext({ ...RUN, state: 'RUNNING' });
    const repository = new FakeWaitRepository(context);
    const request: RunPauseRequest = { requestedBy: 'auditor', sessionId: 'session', requestedAt: '2026-09-10T08:59:00.000Z' };
    await context.createWait(pauseWaitFor({ waitId: '01a06fd8-0000-7000-8000-0000000000c2', runId: RUN_ID, request, at: NOW.toISOString() }));
    context.events = [];
    return repository;
  }

  it('closes the pause by RESUME and puts the Run back to RUNNING', async () => {
    const repository = await paused();
    const revision = repository.context.run!.revision;
    const outcome = await resumeRun(
      dependencies(repository, { now: () => new Date('2026-09-10T09:05:00.000Z') }),
      { session: SESSION, request: { runId: RUN_ID, expectedRunRevision: revision } },
    );

    expect(outcome).toEqual({ ok: true, state: 'RUNNING', waitId: repository.context.wait!.waitId });
    expect(repository.context.run?.state).toBe('RUNNING');
    // `resume`, never `answer`: generation 45 refuses the other pairing outright.
    expect(repository.context.wait?.closureKind).toBe('resume');
    expect(repository.context.wait?.answerOptionId).toBe('resume');
    expect(repository.context.wait?.actor).toBe('auditor');
    const [event] = repository.context.events;
    expect(event?.eventType).toBe('lifecycle.run-resumed');
    expect(event?.payload).toMatchObject({ priorState: 'PAUSED', state: 'RUNNING', closureKind: 'resume' });
  });

  it('refuses a revision the person did not read', async () => {
    const repository = await paused();
    const outcome = await resumeRun(
      dependencies(repository),
      { session: SESSION, request: { runId: RUN_ID, expectedRunRevision: repository.context.run!.revision + 5 } },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('stale-revision');
    expect(repository.context.run?.state).toBe('PAUSED');
    expect(repository.context.wait?.closedAt).toBeNull();
  });

  it('refuses a Run that is not paused', async () => {
    const repository = new FakeWaitRepository();
    await expect(resumeRun(dependencies(repository), { session: SESSION, request: { runId: RUN_ID, expectedRunRevision: 3 } }))
      .resolves.toEqual({ ok: false, reason: RUN_RESUME_REFUSALS.NOT_PAUSED, code: 'not-paused' });
  });

  /**
   * The mirror of `answerEscalation` refusing a pause. Neither command can act on the
   * other's wait, and generation 45 refuses the contradictory closure row underneath both.
   */
  it('refuses an OPEN ESCALATION, which is not a pause', async () => {
    const context = new FakeWaitContext();
    const repository = new FakeWaitRepository(context);
    await context.createWait({
      waitId: '01a06fd8-0000-7000-8000-0000000000c3',
      runId: RUN_ID,
      kind: 'retry-or-skip',
      options: [{ id: 'retry', label: 'Retry' }, { id: 'skip', label: 'Skip' }],
      openedAt: NOW.toISOString(),
      openedBy: null,
      deadline: '2026-09-10T13:00:00.000Z',
      closedAt: null,
      closureKind: null,
      answerOptionId: null,
      actor: null,
    });

    const outcome = await resumeRun(
      dependencies(repository),
      { session: SESSION, request: { runId: RUN_ID, expectedRunRevision: context.run!.revision } },
    );

    expect(outcome).toEqual({ ok: false, reason: RUN_RESUME_REFUSALS.NOT_PAUSED, code: 'not-paused' });
    expect(context.wait?.closedAt).toBeNull();
    expect(context.run?.state).toBe('AWAITING_AUDITOR');
  });

  it('refuses a malformed request, including a missing revision', async () => {
    const repository = await paused();
    for (const request of [null, { runId: RUN_ID }, { runId: RUN_ID, expectedRunRevision: -1 }, { runId: RUN_ID, expectedRunRevision: '3' }]) {
      const outcome = await resumeRun(dependencies(repository), { session: SESSION, request });
      expect(outcome.ok).toBe(false);
    }
    expect(repository.context.wait?.closedAt).toBeNull();
  });
});
