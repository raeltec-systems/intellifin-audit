import { describe, expect, it } from 'vitest';
import type {
  AuditEventDraft,
  PackageArtifact,
  RunCancellationRequest,
  RunRecord,
  RunResultConditionCount,
  RunResultExclusion,
  RunResultFindings,
  RunResultPublication,
} from '@intellifin/domain';
import {
  EVALUATION_REVIEW_REFUSALS,
  confirmEvaluation,
  rejectEvaluation,
  type EvaluationReviewContext,
  type EvaluationReviewDecision,
  type EvaluationReviewDependencies,
  type EvaluationReviewRepository,
  type EvaluationReviewTarget,
} from './evaluation-review.js';
import type {
  GateCheckRow,
  PackageSeal,
  RunGatePopulationFacts,
  StoredRunResult,
} from './execution-ports.js';

const RUN_ID = '01a06fd8-0000-7000-8000-0000000000a1';
const OBSERVATION_ID = '01a06fd8-0000-7000-8000-0000000000a2';
const DECISION_ID = '01a06fd8-0000-7000-8000-0000000000a3';
const SESSION = { userId: 'auditor', sessionId: 'browser-session' } as const;
const NOW = new Date('2026-09-07T09:00:00.000Z');
const NO_FINDINGS: RunResultFindings = { total: 0, records: [] };

const RUN: RunRecord = {
  runId: RUN_ID,
  correlationId: '01a06fd8-0000-7000-8000-0000000000a4',
  procedureId: '01a06fd8-0000-7000-8000-0000000000a5',
  versionId: '01a06fd8-0000-7000-8000-0000000000a6',
  versionNumber: 1,
  procedureName: 'High-value approvals',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'COMPLETED',
  kind: 'STANDARD',
  initiatorId: SESSION.userId,
  sessionId: SESSION.sessionId,
  initiatedAt: '2026-09-07T08:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01a06fd8-0000-7000-8000-0000000000a7',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null,
};

function pendingResult(): StoredRunResult {
  return {
    runId: RUN_ID,
    version: 1,
    outcome: 'PENDING_CONFIRMATION',
    row: 'pending-confirmation',
    sealed: false,
    runState: 'COMPLETED',
    gatePassed: true,
    sealedAt: '2026-09-07T08:59:00.000Z',
    scope: null,
    publication: {} as RunResultPublication,
  };
}

function target(): EvaluationReviewTarget {
  return {
    runId: RUN_ID,
    observationId: OBSERVATION_ID,
    conditionId: 'C1',
    origin: 'AGENT_JUDGED',
    value: 'EXCEPTION',
    confirmation: 'pending',
    confidence: '0.95',
    rationale: 'Approval evidence conflicts with the policy threshold.',
    evidenceIds: ['01a06fd8-0000-7000-8000-0000000000a8'],
  };
}

class FakeContext implements EvaluationReviewContext {
  run: RunRecord | null = { ...RUN };
  result: StoredRunResult | null = pendingResult();
  reviewRevision: number | null = 0;
  reviewTarget: EvaluationReviewTarget | null = target();
  history: EvaluationReviewDecision[] = [];
  forceStaleWrite = false;
  role: 'auditor' | 'audit-manager' | 'poc-administrator' | null = 'auditor';
  conditions: RunResultConditionCount[] = [
    { conditionId: 'C1', origin: 'AGENT_JUDGED', confirmation: 'pending', value: 'EXCEPTION', total: 1 },
  ];
  events: AuditEventDraft[] = [];
  timeline: number[] = [];
  exceptions: Array<{ observationId: string; raisedAt: string }> = [];
  private sequence = 0;

  authorizationRoles = { findRole: async (): Promise<typeof this.role> => this.role };
  auditEvents = {
    append: async (event: AuditEventDraft) => {
      this.events.push(event);
      this.sequence += 1;
      return { sequence: this.sequence } as never;
    },
  };

  readReviewTarget = async (key: { observationId: string; conditionId: string }): Promise<EvaluationReviewTarget | null> =>
    this.reviewTarget?.observationId === key.observationId && this.reviewTarget.conditionId === key.conditionId
      ? this.reviewTarget
      : null;
  readReviewDecisions = async (key: { observationId: string; conditionId: string }): Promise<readonly EvaluationReviewDecision[]> =>
    this.history.filter((decision) => decision.observationId === key.observationId && decision.conditionId === key.conditionId);
  writeDecision = async (decision: EvaluationReviewDecision, expected: number) => {
    if (this.forceStaleWrite) return { status: 'stale-revision' as const };
    if (this.reviewRevision !== expected) return { status: 'stale-revision' as const };
    if (this.history.some((entry) => entry.observationId === decision.observationId && entry.conditionId === decision.conditionId)) {
      return { status: 'already-decided' as const };
    }
    this.history.push({ ...decision, originalEvidenceIds: [...decision.originalEvidenceIds] });
    this.reviewRevision = decision.reviewRevision;
    this.reviewTarget = {
      ...this.reviewTarget!,
      origin: decision.effectiveOrigin,
      value: decision.effectiveValue,
      confirmation: decision.effectiveConfirmation,
    };
    this.conditions = [{
      conditionId: decision.conditionId,
      origin: decision.effectiveOrigin,
      confirmation: decision.effectiveConfirmation,
      value: decision.effectiveValue,
      total: 1,
    }];
    return { status: 'written' as const, reviewRevision: decision.reviewRevision };
  };

  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => [];
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => null;
  writeSeal = async (_seal: PackageSeal): Promise<void> => undefined;
  notifyTimeline = async (sequence: number): Promise<void> => { this.timeline.push(sequence); };
  readGateChecks = async (): Promise<readonly GateCheckRow[]> => [];
  readCancellation = async (): Promise<RunCancellationRequest | null> => null;
  saveRunState = async (_state: RunRecord['state']): Promise<void> => undefined;
  readPopulationFacts = async (): Promise<RunGatePopulationFacts | null> => null;
  readPopulationRows = async () => [];
  readGateObservations = async () => [];
  readResult = async (): Promise<StoredRunResult | null> => this.result;
  writeResult = async (result: StoredRunResult): Promise<void> => { this.result = result; };
  readResultExclusions = async (): Promise<readonly RunResultExclusion[]> => [];
  readConditionCounts = async (): Promise<readonly RunResultConditionCount[]> => this.conditions;
  readResultFindings = async (): Promise<{ exceptions: RunResultFindings; unevaluated: RunResultFindings }> => ({ exceptions: NO_FINDINGS, unevaluated: NO_FINDINGS });
  frozenPlan = async () => null;
  ensureException = async (observationId: string, raisedAt: string): Promise<void> => {
    this.exceptions.push({ observationId, raisedAt });
  };
  sealPendingResult = async (result: StoredRunResult, expectedVersion: number): Promise<void> => {
    if (!this.result || this.result.version !== expectedVersion) throw new Error('stale result');
    this.result = result;
  };
}

class FakeRepository implements EvaluationReviewRepository {
  constructor(readonly context: FakeContext = new FakeContext()) {}
  async transaction<T>(_runId: string, work: (context: EvaluationReviewContext) => Promise<T>): Promise<T> {
    return work(this.context);
  }
}

function dependencies(repository: FakeRepository): EvaluationReviewDependencies {
  let id = 0;
  return {
    repository,
    roles: { findRole: async () => 'auditor' },
    unitOfWork: {
      execute: async (work) => work({
        auditEvents: { append: async () => ({ sequence: 1 }) as never },
      }),
    },
    ids: { next: () => id++ === 0 ? '01a06fd8-0000-7000-8000-0000000000b1' : DECISION_ID },
    clock: { now: () => NOW },
  };
}

function request(expectedReviewRevision = 0) {
  return {
    runId: RUN_ID,
    observationId: OBSERVATION_ID,
    conditionId: 'C1',
    expectedReviewRevision,
  };
}

describe('evaluation review commands', () => {
  it('confirms a pending agent proposal, preserving its immutable evidence snapshot', async () => {
    const repository = new FakeRepository();
    const result = await confirmEvaluation(dependencies(repository), { session: SESSION, request: request() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision).toMatchObject({
      action: 'confirm',
      originalOrigin: 'AGENT_JUDGED',
      originalValue: 'EXCEPTION',
      originalConfirmation: 'pending',
      effectiveOrigin: 'AGENT_JUDGED',
      effectiveValue: 'EXCEPTION',
      effectiveConfirmation: 'confirmed',
      reviewRevision: 1,
      actorId: SESSION.userId,
      decidedAt: NOW.toISOString(),
    });
    expect(result.decision.originalEvidenceIds).toEqual(['01a06fd8-0000-7000-8000-0000000000a8']);
    expect(repository.context.events[0]).toMatchObject({
      eventType: 'execution.evaluation-confirmed',
      actor: { type: 'human', id: SESSION.userId },
      payload: { action: 'confirm', reviewRevision: 1, effectiveValue: 'EXCEPTION' },
    });
    expect(repository.context.exceptions).toEqual([{ observationId: OBSERVATION_ID, raisedAt: NOW.toISOString() }]);
    expect(repository.context.timeline).toEqual([1, 2, 3]);
    expect(result.result).toMatchObject({ sealed: true, version: 2, outcome: 'INCONCLUSIVE' });
    expect(repository.context.reviewRevision).toBe(1);
  });

  it('rejects only with a replacement and rationale, and records a HUMAN effective value', async () => {
    const repository = new FakeRepository();
    const result = await rejectEvaluation(dependencies(repository), {
      session: SESSION,
      request: { ...request(), replacementValue: 'UNEVALUATED', rationale: 'The agent cited evidence outside the frozen scope.' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision).toMatchObject({
      action: 'reject',
      effectiveOrigin: 'HUMAN',
      effectiveValue: 'UNEVALUATED',
      effectiveConfirmation: null,
      replacementValue: 'UNEVALUATED',
      rejectionRationale: 'The agent cited evidence outside the frozen scope.',
    });
    expect(repository.context.events[0]).toMatchObject({
      eventType: 'execution.evaluation-rejected',
      payload: { replacementValue: 'UNEVALUATED' },
    });
  });

  it('refuses malformed rejection input before opening the transaction', async () => {
    const repository = new FakeRepository();
    const result = await rejectEvaluation(dependencies(repository), { session: SESSION, request: request() });
    expect(result).toEqual({ ok: false, code: 'invalid-replacement', reason: EVALUATION_REVIEW_REFUSALS['invalid-replacement'] });
    expect(repository.context.history).toHaveLength(0);
  });

  it('refuses stale review revisions under the Result lock', async () => {
    const repository = new FakeRepository();
    repository.context.reviewRevision = 3;
    const result = await confirmEvaluation(dependencies(repository), { session: SESSION, request: request(2) });
    expect(result).toEqual({ ok: false, code: 'stale-revision', reason: EVALUATION_REVIEW_REFUSALS['stale-revision'] });
    expect(repository.context.history).toHaveLength(0);
  });

  it('maps a concurrent compare-and-set loss to a stale refusal without an audit decision', async () => {
    const repository = new FakeRepository();
    repository.context.forceStaleWrite = true;
    const result = await confirmEvaluation(dependencies(repository), { session: SESSION, request: request() });
    expect(result).toEqual({ ok: false, code: 'stale-revision', reason: EVALUATION_REVIEW_REFUSALS['stale-revision'] });
    expect(repository.context.history).toHaveLength(0);
    expect(repository.context.events).toHaveLength(0);
  });

  it.each([
    [{ ...request(), replacementValue: 'UNEVALUATED', rationale: '  ' }, 'rationale-required'],
    [{ ...request(), replacementValue: 'not-a-value', rationale: 'Needs a human decision.' }, 'invalid-replacement'],
  ] as const)('refuses a reject request with invalid %s', async (reviewRequest, code) => {
    const repository = new FakeRepository();
    const result = await rejectEvaluation(dependencies(repository), { session: SESSION, request: reviewRequest });
    expect(result).toMatchObject({ ok: false, code });
    expect(repository.context.history).toHaveLength(0);
  });

  it.each([
    ['RUNNING', 'not-completed'],
    ['sealed', 'sealed'],
    ['target', 'not-pending'],
  ] as const)('applies terminal and pending guards (%s)', async (kind, code) => {
    const repository = new FakeRepository();
    if (kind === 'RUNNING') repository.context.run = { ...RUN, state: 'RUNNING' };
    if (kind === 'sealed') repository.context.result = { ...pendingResult(), sealed: true };
    if (kind === 'target') repository.context.reviewTarget = { ...target(), origin: 'RULE' };
    const result = await confirmEvaluation(dependencies(repository), { session: SESSION, request: request() });
    expect(result).toMatchObject({ ok: false, code });
    expect(repository.context.history).toHaveLength(0);
  });

  it('rechecks the role in the transaction and audits a revocation refusal', async () => {
    const repository = new FakeRepository();
    repository.context.role = null;
    const result = await confirmEvaluation(dependencies(repository), { session: SESSION, request: request() });
    expect(result).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('does not permit a second decision when the target has immutable history', async () => {
    const repository = new FakeRepository();
    repository.context.history.push({
      decisionId: DECISION_ID,
      runId: RUN_ID,
      observationId: OBSERVATION_ID,
      conditionId: 'C1',
      reviewRevision: 1,
      action: 'confirm',
      originalOrigin: 'AGENT_JUDGED',
      originalValue: 'EXCEPTION',
      originalConfirmation: 'pending',
      originalConfidence: '0.95',
      originalRationale: 'old',
      originalEvidenceIds: [],
      effectiveOrigin: 'AGENT_JUDGED',
      effectiveValue: 'EXCEPTION',
      effectiveConfirmation: 'confirmed',
      replacementValue: null,
      rejectionRationale: null,
      actorId: SESSION.userId,
      decidedAt: NOW.toISOString(),
    });
    const result = await confirmEvaluation(dependencies(repository), { session: SESSION, request: request() });
    expect(result).toMatchObject({ ok: false, code: 'not-pending' });
  });
});
