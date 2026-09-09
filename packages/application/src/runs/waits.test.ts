import { describe, expect, it } from 'vitest';
import type {
  PackageArtifact,
  RunCancellationRequest,
  RunResultConditionCount,
  RunResultExclusion,
  RunResultFindings,
  RunRecord,
  RunResultPublication,
} from '@intellifin/domain';
import {
  ANSWER_ESCALATION_REFUSALS,
  AWAITING_AUDITOR_TIMEOUT_MS,
  ESCALATION_OPTION_IDS,
  FIXED_ESCALATION_OPTIONS,
  candidateMatchDisposition,
  answerEscalation,
  parseWaitJob,
  raiseEscalation,
  wakeEscalation,
  type RunWait,
  type VersionedRun,
  type WaitContext,
  type WaitOperation,
  type WaitRepository,
} from './waits.js';
import type {
  GateCheckRow,
  PackageSeal,
  RunGatePopulationFacts,
  StoredRunResult,
} from './execution-ports.js';

const RUN_ID = '01a06fd8-0000-7000-8000-0000000000a1';
const WAIT_ID = '01a06fd8-0000-7000-8000-0000000000a2';
const NOW = new Date('2026-09-07T09:00:00.000Z');
const SESSION = { userId: 'auditor', sessionId: 'session' } as const;

const RUN: VersionedRun = {
  runId: RUN_ID,
  correlationId: '01a06fd8-0000-7000-8000-0000000000a3',
  procedureId: '01a06fd8-0000-7000-8000-0000000000a4',
  versionId: '01a06fd8-0000-7000-8000-0000000000a5',
  versionNumber: 1,
  procedureName: 'Terminated users',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: SESSION.userId,
  sessionId: SESSION.sessionId,
  initiatedAt: '2026-09-07T08:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01a06fd8-0000-7000-8000-0000000000a6',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null,
  revision: 0,
};

const NO_FINDINGS: RunResultFindings = { total: 0, records: [] };

class FakeWaitContext implements WaitContext {
  run: VersionedRun | null;
  wait: RunWait | null = null;
  role: 'auditor' | 'audit-manager' | 'poc-administrator' | null = 'auditor';
  result: StoredRunResult | null = null;
  seal: PackageSeal | null = null;
  events: { eventType: string; payload: Record<string, unknown> }[] = [];
  private sequence = 0;

  constructor(run: VersionedRun = RUN) {
    this.run = { ...run };
  }

  authorizationRoles = { findRole: async (): Promise<typeof this.role> => this.role };
  readWait = async (waitId: string): Promise<RunWait | null> => this.wait?.waitId === waitId ? this.wait : null;
  readEscalationDetails = async (): Promise<null> => null;
  auditEvents = {
    append: async (draft: { eventType: string; payload: Record<string, unknown> }) => {
      this.sequence += 1;
      this.events.push({ eventType: draft.eventType, payload: draft.payload });
      return { sequence: this.sequence } as never;
    },
  };

  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => [];
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => this.seal;
  writeSeal = async (seal: PackageSeal): Promise<void> => {
    this.seal = seal;
  };
  notifyTimeline = async (): Promise<void> => undefined;
  readGateChecks = async (): Promise<readonly GateCheckRow[]> => [];
  readCancellation = async (): Promise<RunCancellationRequest | null> => null;
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    if (this.run && this.run.state !== state) this.run = { ...this.run, state, revision: this.run.revision + 1 };
  };
  requestCancellation = async (request: RunCancellationRequest): Promise<void> => {
    if (this.run) this.run = { ...this.run, cancellation: request };
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
  readResultFindings = async (): Promise<{ exceptions: RunResultFindings; unevaluated: RunResultFindings }> => ({ exceptions: NO_FINDINGS, unevaluated: NO_FINDINGS });
  frozenPlan = async () => null;

  async createWait(wait: RunWait): Promise<WaitOperation> {
    if (!this.run) return { outcome: 'missing', wait: null, run: null };
    if (this.run.state !== 'RUNNING') return { outcome: 'not-running', wait: this.wait, run: this.run };
    if (this.wait) return { outcome: 'already-open', wait: this.wait, run: this.run };
    this.run = { ...this.run, state: 'AWAITING_AUDITOR', revision: this.run.revision + 1 };
    this.wait = wait;
    return { outcome: 'created', wait, run: this.run };
  }

  async closeWait(input: { waitId: string; expectedRunRevision: number; answerOptionId: string; actor: string; now: string; stateAfterClose: 'RUNNING' | 'AWAITING_AUDITOR' }): Promise<WaitOperation> {
    if (!this.run || !this.wait || this.wait.waitId !== input.waitId) return { outcome: 'missing', wait: null, run: this.run };
    if (this.wait.closedAt !== null) return { outcome: 'superseded', wait: this.wait, run: this.run };
    if (this.run.revision !== input.expectedRunRevision) return { outcome: 'stale-revision', wait: this.wait, run: this.run };
    if (Date.parse(input.now) >= Date.parse(this.wait.deadline)) return { outcome: 'expired', wait: this.wait, run: this.run };
    if (!this.wait.options.some((option) => option.id === input.answerOptionId)) return { outcome: 'expired', wait: this.wait, run: this.run };
    this.wait = { ...this.wait, closedAt: input.now, closureKind: 'answer', answerOptionId: input.answerOptionId, actor: input.actor };
    this.run = { ...this.run, state: input.stateAfterClose, revision: this.run.revision + 1 };
    return { outcome: 'closed', wait: this.wait, run: this.run };
  }

  async timeoutWait(input: { waitId: string; now: string }): Promise<WaitOperation> {
    if (!this.run || !this.wait || this.wait.waitId !== input.waitId) return { outcome: 'missing', wait: null, run: this.run };
    if (this.wait.closedAt !== null) return { outcome: 'superseded', wait: this.wait, run: this.run };
    if (this.run.state !== 'AWAITING_AUDITOR') return { outcome: 'not-awaiting', wait: this.wait, run: this.run };
    if (Date.parse(input.now) < Date.parse(this.wait.deadline)) return { outcome: 'early', wait: this.wait, run: this.run };
    this.wait = { ...this.wait, closedAt: input.now, closureKind: 'timeout', actor: 'wait-wake' };
    this.run = { ...this.run, state: 'INCONCLUSIVE', revision: this.run.revision + 1 };
    return { outcome: 'timed-out', wait: this.wait, run: this.run };
  }
}

class FakeWaitRepository implements WaitRepository {
  constructor(readonly context = new FakeWaitContext()) {}
  async transaction<T>(_runId: string, work: (context: WaitContext) => Promise<T>): Promise<T> {
    return work(this.context);
  }
  async recoverableWaits(): Promise<readonly { waitId: string; runId: string }[]> {
    return this.context.wait?.closedAt === null ? [{ waitId: this.context.wait.waitId, runId: RUN_ID }] : [];
  }
}

function ids(): { next(): string } {
  let count = 10;
  return { next: () => `01a06fd8-0000-7000-8000-${String(count++).padStart(12, '0')}` };
}

function answerDependencies(repository: WaitRepository, clock: { now(): Date } = { now: () => NOW }) {
  return {
    repository,
    roles: { findRole: async () => 'auditor' as const },
    unitOfWork: { execute: async () => undefined } as never,
    ids: ids(),
    clock,
  };
}

describe('durable Escalation waits', () => {
  it('keeps the FR-27 fixed answer sets closed and ordered', () => {
    expect(FIXED_ESCALATION_OPTIONS['unnamed-value'].map((option) => option.id)).toEqual([
      ESCALATION_OPTION_IDS.markUnevaluated,
      ESCALATION_OPTION_IDS.abort,
    ]);
    expect(FIXED_ESCALATION_OPTIONS['retry-or-skip'].map((option) => option.id)).toEqual([
      ESCALATION_OPTION_IDS.retry,
      ESCALATION_OPTION_IDS.skip,
      ESCALATION_OPTION_IDS.abort,
    ]);
  });

  it('refuses malformed candidate options without throwing or accepting reserved actions', async () => {
    const repository = new FakeWaitRepository();
    await expect(raiseEscalation(
      { repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } },
      { runId: RUN_ID, kind: 'choose-candidate', options: [null as never, { id: ESCALATION_OPTION_IDS.markAmbiguous, label: 'Ambiguous' }] },
    )).resolves.toMatchObject({ ok: false, reason: 'Choose a supported Escalation and its closed answer set.' });
    await expect(raiseEscalation(
      { repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } },
      { runId: RUN_ID, kind: 'choose-candidate', options: [{ id: ESCALATION_OPTION_IDS.abort, label: 'Abort' }, { id: ESCALATION_OPTION_IDS.markAmbiguous, label: 'Ambiguous' }] },
    )).resolves.toMatchObject({ ok: false, reason: 'Choose a supported Escalation and its closed answer set.' });
  });

  it('refuses untrusted wait metadata before opening a transaction', async () => {
    const repository = new FakeWaitRepository();
    let called = false;
    repository.transaction = async () => { called = true; throw new Error('transaction should not be reached'); };
    await expect(raiseEscalation(
      { repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } },
      { runId: RUN_ID, kind: 'unnamed-value', stepId: { toString: () => 'step-1' } as never },
    )).resolves.toMatchObject({ ok: false, reason: 'Choose a supported Escalation and its closed answer set.' });
    await expect(raiseEscalation(
      { repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } },
      { runId: RUN_ID, kind: 'unnamed-value', supportingEvidenceIds: [null as never] },
    )).resolves.toMatchObject({ ok: false, reason: 'Choose a supported Escalation and its closed answer set.' });
    expect(called).toBe(false);
  });

  it('resolves only one grounded key match and escalates every other non-empty result', () => {
    expect(candidateMatchDisposition([], 'E-1')).toBe('absence');
    expect(candidateMatchDisposition([{ groundedKey: 'E-1' }], 'E-1')).toBe('platform-resolve');
    expect(candidateMatchDisposition([{ groundedKey: 'other' }, { groundedKey: 'E-1' }], 'E-1')).toBe('platform-resolve');
    expect(candidateMatchDisposition([{ groundedKey: 'E-1' }, { groundedKey: 'E-1' }], 'E-1')).toBe('choose-candidate');
    expect(candidateMatchDisposition([{ groundedKey: 'other' }], 'E-1')).toBe('choose-candidate');
  });

  it('raises one wait, enters Awaiting Auditor, and computes the four-hour deadline', async () => {
    const repository = new FakeWaitRepository();
    const result = await raiseEscalation(
      { repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } },
      {
        runId: RUN_ID,
        kind: 'choose-candidate',
        options: [
          { id: 'candidate-1', label: 'Ada Musonda' },
          { id: 'candidate-2', label: 'Ada Musonda (duplicate)' },
          { id: ESCALATION_OPTION_IDS.markAmbiguous, label: 'Mark the record ambiguous' },
        ],
        stepId: 'step-1',
        supportingEvidenceIds: ['01a06fd8-0000-7000-8000-0000000000a7'],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wait.deadline).toBe(new Date(NOW.getTime() + AWAITING_AUDITOR_TIMEOUT_MS).toISOString());
    expect(result.wait.closedAt).toBeNull();
    expect(repository.context.run).toMatchObject({ state: 'AWAITING_AUDITOR', revision: 1 });
    expect(repository.context.events.map((event) => event.eventType)).toEqual(['execution.escalation-raised']);
    expect(repository.context.events[0]?.payload).toMatchObject({
      optionIds: ['candidate-1', 'candidate-2', ESCALATION_OPTION_IDS.markAmbiguous],
      supportingEvidenceIds: ['01a06fd8-0000-7000-8000-0000000000a7'],
    });
  });

  it('refuses a second open wait without replacing the first', async () => {
    const repository = new FakeWaitRepository();
    const first = await raiseEscalation({ repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } }, { runId: RUN_ID, kind: 'unnamed-value' });
    const second = await raiseEscalation({ repository, ids: { next: () => '01a06fd8-0000-7000-8000-0000000000a8' }, clock: { now: () => NOW } }, { runId: RUN_ID, kind: 'retry-or-skip' });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: 'This Run already has an open Escalation.' });
    expect(repository.context.wait?.kind).toBe('unnamed-value');
  });

  it('requires the expected revision, closes once, and refuses a duplicate answer', async () => {
    const repository = new FakeWaitRepository();
    await raiseEscalation({ repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } }, { runId: RUN_ID, kind: 'unnamed-value' });
    const deps = answerDependencies(repository);
    const stale = await answerEscalation(deps, { session: SESSION, request: { runId: RUN_ID, waitId: WAIT_ID, expectedRunRevision: 0, answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated } });
    expect(stale).toMatchObject({ ok: false, code: 'stale-revision', reason: ANSWER_ESCALATION_REFUSALS['stale-revision'] });
    const answered = await answerEscalation(deps, { session: SESSION, request: { runId: RUN_ID, waitId: WAIT_ID, expectedRunRevision: 1, answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated } });
    expect(answered).toMatchObject({ ok: true, state: 'RUNNING', answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated });
    expect(repository.context.wait).toMatchObject({ closureKind: 'answer', actor: SESSION.userId });
    const duplicate = await answerEscalation(deps, { session: SESSION, request: { runId: RUN_ID, waitId: WAIT_ID, expectedRunRevision: 2, answerOptionId: ESCALATION_OPTION_IDS.markUnevaluated } });
    expect(duplicate).toMatchObject({ ok: false, code: 'closed' });
  });

  it('times out an open wait once and rejects a wake job with extra payload', async () => {
    const repository = new FakeWaitRepository();
    await raiseEscalation({ repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } }, { runId: RUN_ID, kind: 'retry-or-skip' });
    expect(parseWaitJob({ schemaVersion: 1, runId: RUN_ID, waitId: WAIT_ID, answerOptionId: 'retry' })).toBeNull();
    expect(parseWaitJob({ schemaVersion: 1, runId: RUN_ID, waitId: WAIT_ID })).toEqual({ schemaVersion: 1, runId: RUN_ID, waitId: WAIT_ID });
    const result = await wakeEscalation({ repository, clock: { now: () => new Date(NOW.getTime() + AWAITING_AUDITOR_TIMEOUT_MS) } }, { schemaVersion: 1, runId: RUN_ID, waitId: WAIT_ID });
    expect(result).toMatchObject({ ok: true, status: 'timed-out' });
    expect(repository.context.run).toMatchObject({ state: 'INCONCLUSIVE' });
    expect(repository.context.wait).toMatchObject({ closureKind: 'timeout', actor: 'wait-wake' });
    const replay = await wakeEscalation({ repository, clock: { now: () => new Date(NOW.getTime() + AWAITING_AUDITOR_TIMEOUT_MS + 1) } }, { schemaVersion: 1, runId: RUN_ID, waitId: WAIT_ID });
    expect(replay).toMatchObject({ ok: true, status: 'superseded' });
    const lateAnswer = await answerEscalation(answerDependencies(repository, { now: () => new Date(NOW.getTime() + AWAITING_AUDITOR_TIMEOUT_MS + 1) }), {
      session: SESSION,
      request: { runId: RUN_ID, waitId: WAIT_ID, expectedRunRevision: 2, answerOptionId: ESCALATION_OPTION_IDS.retry },
    });
    expect(lateAnswer).toMatchObject({ ok: false, code: 'timed-out', timedOutAt: expect.any(String) });
  });

  it('routes abort through the cancellation seam and records the fixed reason', async () => {
    const repository = new FakeWaitRepository();
    await raiseEscalation({ repository, ids: { next: () => WAIT_ID }, clock: { now: () => NOW } }, { runId: RUN_ID, kind: 'unnamed-value' });
    const result = await answerEscalation(answerDependencies(repository), { session: SESSION, request: { runId: RUN_ID, waitId: WAIT_ID, expectedRunRevision: 1, answerOptionId: ESCALATION_OPTION_IDS.abort } });
    expect(result).toMatchObject({ ok: true, state: 'CANCELED', answerOptionId: ESCALATION_OPTION_IDS.abort });
    expect(repository.context.run?.state).toBe('CANCELED');
    expect(repository.context.events.map((event) => event.eventType)).toEqual([
      'execution.escalation-raised',
      'execution.escalation-answered',
      'lifecycle.run-canceled',
      'lifecycle.evidence-package-sealed',
      'lifecycle.result-sealed',
    ]);
    expect(repository.context.events[2]?.payload).toMatchObject({ reason: 'Escalation answer: abort' });
  });
});
