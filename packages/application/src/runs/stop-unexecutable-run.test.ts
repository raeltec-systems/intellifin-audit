import { describe, expect, it } from 'vitest';
import type {
  ExecutablePlan,
  PackageArtifact,
  RunCancellationRequest,
  RunRecord,
  RunResultConditionCount,
  RunResultExclusion,
  RunResultFindings, RunPauseRequest } from '@intellifin/domain';
import { stopUnexecutableRun, UNEXECUTABLE_RUN_REASONS } from './stop-unexecutable-run.js';
import type {
  GateCheckRow,
  PackageSeal,
  PopulationCheckpoint,
  PopulationExecutionContext,
  PopulationExecutionRepository,
  RunGatePopulationFacts,
  StoredRunResult,
} from './execution-ports.js';

/**
 * A Run this deployment cannot execute (PR 23 review, P1-6 and P1-7).
 *
 * Two ways to be stranded, one answer. Without object storage the worker registered no
 * `runs` consumer at all while the web went on enqueueing, so a Run sat QUEUED for ever —
 * no diagnostic, no Result, nothing on the page saying anything was wrong. With storage but
 * no credential manifest the handler acknowledged the job AFTER acquisition, leaving the
 * Run RUNNING at `POPULATION_READY` with its population Evidence frozen and neither sweep
 * able to select it again.
 *
 * §E maps a Run-level Session Step that cannot be performed to `RUN_FAILED`, and that is
 * what this writes — through `completeRun`, so the Result and the Evidence package seal
 * commit with it rather than being dodged.
 */

const RUN: RunRecord = {
  runId: '01a06fd8-0000-7000-8000-0000000000f1',
  correlationId: '01a06fd8-0000-7000-8000-0000000000f2',
  procedureId: '01a06fd8-0000-7000-8000-0000000000f3',
  versionId: '01a06fd8-0000-7000-8000-0000000000f4',
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
  requestToken: '01a06fd8-0000-7000-8000-0000000000f5',
};

const JOB = { schemaVersion: 1 as const, runId: RUN.runId, correlationId: RUN.correlationId };
const NOW = new Date('2026-09-06T10:00:00.000Z');
const NO_FINDINGS: RunResultFindings = { total: 0, records: [] };

class FakePopulation implements PopulationExecutionContext {
  run: RunRecord | null = { ...RUN };
  checkpoint: PopulationCheckpoint | null = null;
  result: StoredRunResult | null = null;
  seal: PackageSeal | null = null;
  states: RunRecord['state'][] = [];
  saves: { checkpoint: PopulationCheckpoint; state: RunRecord['state'] }[] = [];
  events: { eventType: string; outcome: string; payload: Record<string, unknown> }[] = [];
  artifacts: PackageArtifact[] = [];
  private sequence = 0;

  auditEvents = {
    append: async (draft: { eventType: string; outcome: string; payload: Record<string, unknown> }) => {
      this.sequence += 1;
      this.events.push({ eventType: draft.eventType, outcome: draft.outcome, payload: draft.payload });
      return { sequence: this.sequence } as never;
    },
  };

  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => this.artifacts;
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => this.seal;
  writeSeal = async (seal: PackageSeal): Promise<void> => {
    this.seal = seal;
  };
  notifyTimeline = async (): Promise<void> => undefined;

  frozenPlan = async (): Promise<ExecutablePlan | null> => null;
  save = async (
    checkpoint: PopulationCheckpoint,
    state: RunRecord['state'],
    _result?: unknown,
  ): Promise<void> => {
    this.saves.push({ checkpoint, state });
    if (this.run !== null) this.run = { ...this.run, state };
  };

  readGateChecks = async (): Promise<readonly GateCheckRow[]> => [];
  readCancellation = async (): Promise<RunCancellationRequest | null> => this.run?.cancellation ?? null;
  readPauseRequest = async (): Promise<RunPauseRequest | null> => this.pauseRequest ?? null;
  /** Generation 47. This context never opens a wait, so there is never one to withdraw. */
  withdrawOpenWait = async (): Promise<null> => null;
  pauseRequest: RunPauseRequest | null = null;
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    this.states.push(state);
    if (this.run !== null) this.run = { ...this.run, state };
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

function repositoryOf(context: FakePopulation): PopulationExecutionRepository {
  return {
    transaction: async (runId, work) => {
      expect(runId).toBe(RUN.runId);
      return work(context);
    },
    recoverableRunIds: async () => [],
  };
}

function deps(context: FakePopulation) {
  return { repository: repositoryOf(context), clock: { now: () => NOW } };
}

describe('stopUnexecutableRun', () => {
  it('ends a QUEUED Run RUN_FAILED with a diagnostic naming the missing capability', async () => {
    const context = new FakePopulation();
    const outcome = await stopUnexecutableRun(deps(context), JOB, 'evidence-store-unconfigured');
    // The queue job is acknowledged: the decision was taken once at boot, so retrying it
    // against a configuration that cannot have changed proves nothing.
    expect(outcome).toEqual({ retry: false });
    expect(context.states).toEqual(['RUN_FAILED']);
    const event = context.events.find((entry) => entry.eventType === 'lifecycle.run-unexecutable');
    expect(event).toBeDefined();
    expect(event!.outcome).toBe('failure');
    expect(event!.payload).toMatchObject({
      priorState: 'QUEUED',
      state: 'RUN_FAILED',
      diagnostic: 'evidence-store-unconfigured',
      reason: UNEXECUTABLE_RUN_REASONS['evidence-store-unconfigured'],
    });
    // Through `completeRun`, so the Result and the seal are there rather than a bare state.
    expect(context.result).toMatchObject({ outcome: 'RUN_FAILED', row: 'run-failed', runState: 'RUN_FAILED' });
    expect(context.seal).toMatchObject({ state: 'SEALED', runState: 'RUN_FAILED' });
  });

  it('writes NO checkpoint and reserves NO Evidence for a Run that never started', async () => {
    // A reservation invented here would make the seal list an abandonment for an artifact
    // nobody ever asked for, on a Run where nothing was attempted at all.
    const context = new FakePopulation();
    await stopUnexecutableRun(deps(context), JOB, 'evidence-store-unconfigured');
    expect(context.saves).toEqual([]);
    expect(context.checkpoint).toBeNull();
    expect(context.seal).toMatchObject({ requiredTotal: 0, registered: 0, missingRequired: [] });
  });

  it('stops a RUNNING Run whose population is ready, leaving that checkpoint alone', async () => {
    // P1-7: acquisition succeeded and its Evidence is frozen. The population really was
    // ready; what failed is the stage after it, so the checkpoint is not rewritten.
    const context = new FakePopulation();
    context.run = { ...RUN, state: 'RUNNING' };
    context.checkpoint = { status: 'POPULATION_READY' } as unknown as PopulationCheckpoint;
    await stopUnexecutableRun(deps(context), JOB, 'adapter-extraction-unconfigured');
    expect(context.states).toEqual(['RUN_FAILED']);
    expect(context.saves).toEqual([]);
    expect(context.checkpoint).toMatchObject({ status: 'POPULATION_READY' });
    expect(context.events.find((entry) => entry.eventType === 'lifecycle.run-unexecutable')!.payload)
      .toMatchObject({ priorState: 'RUNNING', diagnostic: 'adapter-extraction-unconfigured' });
  });

  it('does nothing to a Run that has already stopped', async () => {
    const context = new FakePopulation();
    context.run = { ...RUN, state: 'INCONCLUSIVE' };
    await stopUnexecutableRun(deps(context), JOB, 'evidence-store-unconfigured');
    expect(context.states).toEqual([]);
    expect(context.events).toEqual([]);
    expect(context.result).toBeNull();
  });

  it('does nothing for a job whose correlation id is not this Run’s', async () => {
    const context = new FakePopulation();
    await stopUnexecutableRun(
      deps(context),
      { ...JOB, correlationId: '01a06fd8-0000-7000-8000-00000000ffff' },
      'evidence-store-unconfigured',
    );
    expect(context.events).toEqual([]);
  });

  it('honours a cancellation instead, because a Run that never ran earned no outcome', async () => {
    const request: RunCancellationRequest = {
      requestedBy: 'auditor',
      sessionId: 'browser-session',
      requestedAt: '2026-09-06T09:59:00.000Z',
      reason: 'Wrong period.',
    };
    const context = new FakePopulation();
    context.run = { ...RUN, cancellation: request };
    await stopUnexecutableRun(deps(context), JOB, 'evidence-store-unconfigured');
    expect(context.states).toEqual(['CANCELED']);
    expect(context.result).toMatchObject({ outcome: 'CANCELED', row: 'canceled' });
    const types = context.events.map((entry) => entry.eventType);
    expect(types).toContain('lifecycle.run-canceled');
    // Not both: the person's request is the whole truth about why this Run ended.
    expect(types).not.toContain('lifecycle.run-unexecutable');
    expect(types).not.toContain('lifecycle.cancellation-superseded');
  });

  it('writes one Result, not two, on a redelivery', async () => {
    const context = new FakePopulation();
    await stopUnexecutableRun(deps(context), JOB, 'evidence-store-unconfigured');
    const first = context.result;
    await stopUnexecutableRun(deps(context), JOB, 'evidence-store-unconfigured');
    expect(context.result).toBe(first);
    expect(context.events.filter((entry) => entry.eventType === 'lifecycle.run-unexecutable'))
      .toHaveLength(1);
  });
});
