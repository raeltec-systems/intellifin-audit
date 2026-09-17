import { describe, expect, it } from 'vitest';
import {
  bindingDigest,
  bindingDigestEnvelope,
  deriveExecutablePlan,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  registrationDigest,
  snapshotFromRegistration,
  type ExecutablePlan,
  type PackageArtifact,
  type RunCancellationRequest,
  type RunRecord,
  type RunResultConditionCount,
  type RunResultExclusion,
  type RunResultFindings,
  type ReplayRecording, type RunPauseRequest } from '@intellifin/domain';

import { provisionWorkspace, releaseWorkspace } from './provision-workspace.js';
import {
  BrowserActionError,
  WorkspaceProvisionError,
  type BrowserExecution,
  type GateCheckRow,
  type PackageSeal,
  type RunGatePopulationFacts,
  type StepExecutionRecord,
  type StoredRunResult,
  type WorkspaceCheckpoint,
  type WorkspaceDenial,
  type WorkspaceExecutionContext,
  type WorkspaceExecutionRepository,
  type WorkspaceHandle,
  type WorkspaceRef,
} from './execution-ports.js';

/**
 * `ProvisionWorkspace` and `ReleaseWorkspace` over a fake repository and a fake provider.
 *
 * `tests/integration/agent-workspace.test.ts` drives the same commands against PostgreSQL
 * and a real Chromium; what is pinned here is every row of the story's own I/O matrix,
 * including the ones a real provider cannot be made to produce on demand — an entitlement
 * refusal, and a reattach that is impossible.
 */

const RUN: RunRecord = {
  runId: '01a06fd8-0000-7000-8000-0000000000f1',
  correlationId: '01a06fd8-0000-7000-8000-0000000000f2',
  procedureId: '01a06fd8-0000-7000-8000-0000000000f3',
  versionId: '01a06fd8-0000-7000-8000-0000000000f4',
  versionNumber: 1,
  procedureName: 'Segregation of duties',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'QUEUED',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-06T00:00:00.000Z',
  authorizationRole: 'auditor',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null, pauseRequest: null,
  requestToken: '01a06fd8-0000-7000-8000-0000000000f5',
};

const JOB = { schemaVersion: 1 as const, runId: RUN.runId, correlationId: RUN.correlationId };

/**
 * A real compiler-1 plan, derived rather than hand-built.
 *
 * `create-workspace` is emitted FIRST exactly when a selected Target is web or desktop, so
 * a hand-made plan agreeing with a hand-made expectation would prove nothing about which
 * Runs actually get a workspace.
 */
function planFor(kind: 'web' | 'api'): ExecutablePlan {
  const registration = {
    registrationId: '018f0000-0000-7000-8000-0000000000a1',
    displayName: 'ProdConsole',
    kind,
    allowedOrigins: ['https://synthetic.invalid/console'],
    applicationIdentity: '',
    credentialRef: 'vault://synthetic/prod',
    permittedActions:
      kind === 'web'
        ? (['navigate', 'read-attribute'] as const)
        : (['list-records', 'read-attribute'] as const),
    attributeLabelPatterns: ['Account'],
    secondaryKey: '',
  };
  const source = {
    kind: 'versioned-file' as const,
    location: 'https://synthetic.invalid/accounts.csv',
    declaredSchema: ['account_id', 'status'],
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  // P-2, which accepts either kind of Target System, so the ONE difference between the two
  // plans is the thing under test: whether the compiler emitted `create-workspace`.
  const derived = deriveExecutablePlan({
    ...initialDraftPopulation('P-2'),
    ...initialDraftCompliance('P-2'),
    ...initialDraftEvidence('P-2'),
    templateId: 'P-2',
    controlName: 'Segregation of duties',
    sections: initialDraftSections('P-2'),
    scope: 'All accounts',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: '018f0000-0000-7000-8000-000000000099',
      displayName: 'Accounts',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
    instructions:
      kind === 'web'
        ? [{ registrationId: registration.registrationId, text: 'Read the account role list.' }]
        : [],
  });
  if (!derived.ok) throw new Error(derived.reason);
  return derived.plan;
}

const agentPlan = (): ExecutablePlan => planFor('web');
const adapterPlan = (): ExecutablePlan => planFor('api');

class FakeContext implements WorkspaceExecutionContext {
  run: RunRecord | null;
  checkpoint: WorkspaceCheckpoint | null;
  plan: ExecutablePlan | null;
  saved: { checkpoint: WorkspaceCheckpoint; state: RunRecord['state'] }[] = [];
  executions: StepExecutionRecord[] = [];
  events: { eventType: string; outcome: string; payload: Record<string, unknown> }[] = [];
  seal: PackageSeal | null = null;
  result: StoredRunResult | null = null;
  /**
   * The cancellation marker `completeRun` reads on the transaction's connection.
   *
   * Added by the Epic 3 merge: a Run that outruns a cancellation still concludes on its own
   * outcome, and `completeRun` appends `lifecycle.cancellation-superseded` so the request is
   * not answered by silence. `null` here is "nobody asked", which is every workspace test.
   */
  cancellation: RunCancellationRequest | null = null;
  private sequence = 0;

  readCancellation = async (): Promise<RunCancellationRequest | null> => this.cancellation;
  readPauseRequest = async (): Promise<RunPauseRequest | null> => this.pauseRequest ?? null;
  /** Generation 47. This context never opens a wait, so there is never one to withdraw. */
  withdrawOpenWait = async (): Promise<null> => null;
  pauseRequest: RunPauseRequest | null = null;

  constructor(private readonly store: Store) {
    this.run = store.run;
    this.checkpoint = store.checkpoint;
    this.plan = store.plan;
  }

  auditEvents = {
    append: async (draft: {
      eventType: string;
      outcome: string;
      payload: Record<string, unknown>;
    }) => {
      this.sequence += 1;
      this.store.events.push({
        eventType: draft.eventType,
        outcome: draft.outcome,
        payload: draft.payload,
      });
      return { sequence: this.sequence } as never;
    },
  };

  frozenPlan = async (): Promise<ExecutablePlan | null> => this.plan;
  save = async (checkpoint: WorkspaceCheckpoint, state: RunRecord['state']): Promise<void> => {
    this.store.checkpoint = checkpoint;
    this.store.run = this.store.run === null ? null : { ...this.store.run, state };
    this.store.saved.push({ checkpoint, state });
  };
  saveStepExecution = async (execution: StepExecutionRecord): Promise<void> => {
    this.store.executions.push(execution);
  };
  /** Story 5.2: the copy is attempted once per Run; the FIRST answer wins. */
  recording: ReplayRecording | null = null;
  readRecording = async (): Promise<ReplayRecording | null> => this.recording;
  saveRecording = async (recording: ReplayRecording): Promise<void> => {
    this.recording = recording;
  };

  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => [];
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => this.store.seal;
  writeSeal = async (seal: PackageSeal): Promise<void> => {
    this.store.seal = seal;
  };
  notifyTimeline = async (): Promise<void> => undefined;
  readGateChecks = async (): Promise<readonly GateCheckRow[]> => [];
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    this.store.run = this.store.run === null ? null : { ...this.store.run, state };
  };
  readPopulationFacts = async (): Promise<RunGatePopulationFacts | null> => null;
  /** Story 5.2: no Tool Action left a frame gap unless a case says otherwise. */
  readMissingFrames = async () => ({ total: 0, sample: [] });
  readPopulationRows = async () => [];
  readGateObservations = async () => [];
  readResult = async (): Promise<StoredRunResult | null> => this.store.result;
  writeResult = async (result: StoredRunResult): Promise<void> => {
    this.store.result = result;
  };
  readResultExclusions = async (): Promise<readonly RunResultExclusion[]> => [];
  readConditionCounts = async (): Promise<readonly RunResultConditionCount[]> => [];
  readResultFindings = async (): Promise<{
    exceptions: RunResultFindings;
    unevaluated: RunResultFindings;
  }> => ({ exceptions: { total: 0, records: [] }, unevaluated: { total: 0, records: [] } });
}

interface Store {
  run: RunRecord | null;
  checkpoint: WorkspaceCheckpoint | null;
  plan: ExecutablePlan | null;
  saved: { checkpoint: WorkspaceCheckpoint; state: RunRecord['state'] }[];
  executions: StepExecutionRecord[];
  events: { eventType: string; outcome: string; payload: Record<string, unknown> }[];
  seal: PackageSeal | null;
  result: StoredRunResult | null;
}

function store(plan: ExecutablePlan | null, run: RunRecord = RUN): Store {
  return { run, checkpoint: null, plan, saved: [], executions: [], events: [], seal: null, result: null };
}

function repository(state: Store): WorkspaceExecutionRepository {
  return {
    transaction: async (_runId, work) => work(new FakeContext(state)),
    reapableRunIds: async () => [],
  };
}

interface FakeBrowserOptions {
  readonly mode?: 'solari' | 'local';
  /** The provider's hard deadline for every session this fake hands out. */
  readonly expiresAt?: string | null;
  /** Throw on the nth create (1-based); `null` never throws. */
  readonly failCreate?: WorkspaceProvisionError | null;
  /**
   * Throw on every release; `null` never throws.
   *
   * The real adapter resolves `InvalidSessionId` and a 404 as SUCCESS — on a release, "the
   * stored identity is gone" is the outcome asked for — so a release that THROWS is an
   * outage, a capacity refusal or a policy denial, and the remote session may well still be
   * running. There is no provider error this fake could raise that means "already gone".
   */
  readonly failRelease?: Error | null;
  readonly attachable?: boolean;
  readonly denials?: readonly WorkspaceDenial[];
}

class FakeBrowser implements BrowserExecution {
  readonly mode: 'solari' | 'local';
  created: string[] = [];
  attached: WorkspaceRef[] = [];
  released: WorkspaceRef[] = [];
  private counter = 0;

  constructor(private readonly options: FakeBrowserOptions = {}) {
    this.mode = options.mode ?? 'local';
  }

  create = async (input: { runId: string }): Promise<WorkspaceHandle> => {
    if (this.options.failCreate) throw this.options.failCreate;
    this.counter += 1;
    const workspaceId = `ws-${String(this.counter)}`;
    this.created.push(workspaceId);
    return this.handle({ runId: input.runId, workspaceId, mode: this.mode });
  };

  attach = async (ref: WorkspaceRef): Promise<WorkspaceHandle | null> => {
    this.attached.push(ref);
    return this.options.attachable === true ? this.handle(ref) : null;
  };

  // Recorded BEFORE it can throw, so a test can tell "the release was attempted and
  // failed" from "the release was never attempted at all".
  release = async (ref: WorkspaceRef): Promise<void> => {
    this.released.push(ref);
    if (this.options.failRelease) throw this.options.failRelease;
  };
  /** Story 5.2: this fake provider records nothing unless a case says otherwise. */
  downloadRecording = async (): Promise<Uint8Array | null> => null;

  /**
   * Story 4.2's Tool Action port member.
   *
   * This story provisions and releases a workspace and takes no action in one, so a fake
   * that answered here would be a fake for something nothing under test calls. It refuses,
   * which is what a workspace stage attempting a Tool Action would deserve.
   */
  perform = (): Promise<never> => Promise.reject(new BrowserActionError('unavailable'));

  private handle(ref: WorkspaceRef): WorkspaceHandle {
    let drained = false;
    const denials = this.options.denials ?? [];
    return {
      ref,
      expiresAt: this.options.expiresAt ?? null,
      takeDenials: () => {
        if (drained) return [];
        drained = true;
        return denials;
      },
      denied: () => denials.length,
    };
  }
}

const DEPS = (state: Store, browser: BrowserExecution) => ({
  repository: repository(state),
  browser,
  clock: { now: () => new Date('2026-09-06T00:00:00.000Z') },
  ids: { next: () => '01a06fd8-0000-7000-8000-0000000000aa' },
});

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('provisionWorkspace', () => {

  it('seals a named failure and releases a newly opened browser when OPEN persistence rolls back', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari', attachable: true });
    const notices: unknown[] = [];
    const deps = {
      ...DEPS(state, browser),
      reportFailure: (notice: unknown) => { notices.push(notice); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> =>
          repository(state).transaction(runId, async (context) => {
            const save = context.save;
            context.save = async (checkpoint, runState) => {
              if (checkpoint.status === 'OPEN') throw new Error('SQL and password MUST NOT ESCAPE', { cause: { code: '23514', detail: 'provider-secret', constraint_name: 'raw-secret' } });
              await save(checkpoint, runState);
            };
            return work(context);
          }),
      },
    };
    expect(await provisionWorkspace(deps, JOB)).toEqual({ retry: false, provisioned: false, deferred: false });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(state.result).not.toBeNull();
    expect(state.seal).not.toBeNull();
    expect(state.executions).toMatchObject([{ state: 'FAILED', action: 'create-workspace', diagnostic: 'workspace-persistence-failed' }]);
    expect(state.events).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'failure', payload: expect.objectContaining({ diagnostic: 'workspace-persistence-failed', state: 'RUN_FAILED' }) })]));
    expect(browser.created).toEqual(['ws-1']);
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'solari' }]);
    expect(state.checkpoint?.status).toBe('RELEASED');
    expect(notices).toEqual([{ runId: RUN.runId, stage: 'workspace', diagnostic: 'workspace-persistence-failed', errorCode: '23514' }]);
    expect(JSON.stringify({ notices, events: state.events, executions: state.executions })).not.toMatch(/MUST NOT ESCAPE|provider-secret|raw-secret/);
  });

  it('retains the failed session for the reaper when cleanup is unavailable', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari', failRelease: new Error('cleanup-secret') });
    const notices: unknown[] = [];
    const deps = {
      ...DEPS(state, browser),
      reportFailure: (notice: unknown) => { notices.push(notice); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> =>
          repository(state).transaction(runId, async (context) => {
            const save = context.save;
            context.save = async (checkpoint, runState) => {
              if (checkpoint.status === 'OPEN') throw new Error('save-secret');
              await save(checkpoint, runState);
            };
            return work(context);
          }),
      },
    };
    expect(await provisionWorkspace(deps, JOB)).toMatchObject({ retry: false, provisioned: false });
    expect(state.checkpoint).toMatchObject({ status: 'FAILED', workspaceId: 'ws-1', diagnostic: 'workspace-persistence-failed' });
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ diagnostic: 'workspace-cleanup-failed' })]));
    expect(JSON.stringify(notices)).not.toMatch(/cleanup-secret|save-secret/);
  });

  it('does not release a committed workspace when only its commit acknowledgement was lost', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari' });
    let injected = false;
    const deps = {
      ...DEPS(state, browser),
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> => {
          const result = await repository(state).transaction(runId, work);
          if (!injected && state.checkpoint?.status === 'OPEN') { injected = true; throw new Error('lost acknowledgement'); }
          return result;
        },
      },
    };
    expect(await provisionWorkspace(deps, JOB)).toEqual({ retry: false, provisioned: true, deferred: false });
    expect(state.run?.state).toBe('RUNNING');
    expect(state.checkpoint?.status).toBe('OPEN');
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0]?.state).toBe('SUCCEEDED');
    expect(browser.released).toEqual([]);
    expect(browser.created).toEqual(['ws-1']);
  });

  it('reports uncertainty without revoking a browser when the database cannot confirm ownership', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari' });
    const notices: unknown[] = [];
    let calls = 0;
    const deps = {
      ...DEPS(state, browser),
      reportFailure: (notice: unknown) => { notices.push(notice); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> => {
          calls += 1;
          if (calls > 1) throw new Error('database-secret', { cause: { code: '08006' } });
          return repository(state).transaction(runId, work);
        },
      },
    };
    await expect(provisionWorkspace(deps, JOB)).rejects.toThrow('Workspace persistence could not be confirmed');
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'workspace', diagnostic: 'workspace-persistence-unconfirmed', errorCode: '08006' })]));
    expect(JSON.stringify(notices)).not.toContain('database-secret');
    expect(browser.released).toEqual([]);
    expect(browser.created).toEqual(['ws-1']);
  });

  it.each(['', 'x'.repeat(4097)])('refuses an unpersistable provider identity without logging or retaining it', async (workspaceId) => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari' });
    browser.create = async ({ runId }) => ({ ref: { runId, workspaceId, mode: 'solari' }, expiresAt: null, takeDenials: () => [], denied: () => 0 });
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toMatchObject({ retry: false, provisioned: false });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(state.checkpoint).toMatchObject({ workspaceId: null, diagnostic: 'workspace-identity-invalid' });
    expect(browser.released).toHaveLength(1);
    expect(state.executions[0]?.diagnostic).toBe('workspace-identity-invalid');
    expect(JSON.stringify(state.events)).not.toContain('x'.repeat(4097));
  });

  it('cannot let a diagnostic observer or hostile error getter prevent failure sealing', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser();
    const hostile = Object.create(null, { code: { get: () => { throw new Error('getter-secret'); } }, cause: { value: null } });
    const deps = {
      ...DEPS(state, browser),
      reportFailure: () => { throw new Error('sink-secret'); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> =>
          repository(state).transaction(runId, async (context) => {
            const save = context.save;
            context.save = async (checkpoint, runState) => {
              if (checkpoint.status === 'OPEN') throw hostile;
              await save(checkpoint, runState);
            };
            return work(context);
          }),
      },
    };
    await expect(provisionWorkspace(deps, JOB)).resolves.toMatchObject({ retry: false, provisioned: false });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(browser.released).toHaveLength(1);
  });

  it('does not release the winning existing workspace when an older attach loses its lease', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari', attachable: true, expiresAt: '2026-09-07T00:00:00.000Z' });
    let now = Date.parse('2026-09-06T00:00:00.000Z');
    const deps = { ...DEPS(state, browser), clock: { now: () => new Date(now) } };
    await provisionWorkspace(deps, JOB);
    const original = state.checkpoint!;
    const attachStarted = barrier();
    const finishOldAttach = barrier();
    const attach = browser.attach;
    let attaching = 0;
    browser.attach = async (ref) => {
      const handle = await attach(ref);
      if (++attaching === 1) {
        attachStarted.resolve();
        await finishOldAttach.promise;
      }
      return handle;
    };

    const older = provisionWorkspace(deps, JOB);
    await attachStarted.promise;
    expect(state.checkpoint).toMatchObject({ status: 'PROVISIONING', workspaceId: original.workspaceId, mode: 'solari' });
    // Only the clock moves. B obtains and commits its own real claim after A's lease;
    // no test assignment manufactures the winning checkpoint or changes its identity.
    now = Date.parse(state.checkpoint!.leaseUntil) + 1;
    expect(now).toBeLessThan(Date.parse(original.expiresAt!));
    expect(await provisionWorkspace(deps, JOB)).toEqual({ retry: false, provisioned: true, deferred: false });
    expect(state.checkpoint).toMatchObject({ status: 'OPEN', workspaceId: original.workspaceId, mode: 'solari', expiresAt: original.expiresAt });
    const winner = JSON.stringify({ checkpoint: state.checkpoint, events: state.events, executions: state.executions, saved: state.saved });

    finishOldAttach.resolve();
    expect(await older).toEqual({ retry: false, provisioned: false, deferred: false });
    expect(JSON.stringify({ checkpoint: state.checkpoint, events: state.events, executions: state.executions, saved: state.saved })).toBe(winner);
    expect(state.run?.state).toBe('RUNNING');
    expect(browser.created).toEqual([original.workspaceId]);
    expect(browser.attached).toEqual([
      { runId: RUN.runId, workspaceId: original.workspaceId, mode: 'solari' },
      { runId: RUN.runId, workspaceId: original.workspaceId, mode: 'solari' },
    ]);
    expect(browser.released).toEqual([]);
  });

  it('releases only its newly created uncommitted handle when a newer claim wins with another identity', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari', expiresAt: '2026-09-07T00:00:00.000Z' });
    let now = Date.parse('2026-09-06T00:00:00.000Z');
    const deps = { ...DEPS(state, browser), clock: { now: () => new Date(now) } };
    const createStarted = barrier();
    const finishOldCreate = barrier();
    const create = browser.create;
    let creating = 0;
    browser.create = async (input) => {
      const handle = await create(input);
      if (++creating === 1) {
        createStarted.resolve();
        await finishOldCreate.promise;
      }
      return handle;
    };

    const older = provisionWorkspace(deps, JOB);
    await createStarted.promise;
    expect(state.checkpoint).toMatchObject({ status: 'PROVISIONING', workspaceId: null });
    now = Date.parse(state.checkpoint!.leaseUntil) + 1;
    expect(await provisionWorkspace(deps, JOB)).toEqual({ retry: false, provisioned: true, deferred: false });
    expect(state.checkpoint).toMatchObject({ status: 'OPEN', workspaceId: 'ws-2', mode: 'solari' });
    const winner = JSON.stringify({ checkpoint: state.checkpoint, events: state.events, executions: state.executions, saved: state.saved });

    finishOldCreate.resolve();
    expect(await older).toEqual({ retry: false, provisioned: false, deferred: false });
    expect(JSON.stringify({ checkpoint: state.checkpoint, events: state.events, executions: state.executions, saved: state.saved })).toBe(winner);
    expect(state.run?.state).toBe('RUNNING');
    expect(browser.created).toEqual(['ws-1', 'ws-2']);
    expect(browser.attached).toEqual([]);
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'solari' }]);
  });

  it.each([['solari', 'local'], ['local', 'solari']] as const)(
    'preserves the persisted %s identity when a restarted worker selects %s',
    async (originalMode, configuredMode) => {
      const state = store(agentPlan());
      const original = new FakeBrowser({ mode: originalMode, expiresAt: '2026-09-07T00:00:00.000Z' });
      await provisionWorkspace(DEPS(state, original), JOB);
      const identity = state.checkpoint!.workspaceId;
      const restarted = new FakeBrowser({ mode: configuredMode });
      expect(await provisionWorkspace(DEPS(state, restarted), JOB)).toEqual({ retry: false, provisioned: false, deferred: false });
      expect(restarted.created).toEqual([]);
      expect(restarted.attached).toEqual([]);
      expect(restarted.released).toEqual([]);
      expect(state.checkpoint).toMatchObject({
        workspaceId: identity,
        mode: originalMode,
        expiresAt: '2026-09-07T00:00:00.000Z',
        status: 'FAILED',
        diagnostic: 'workspace-policy',
      });
      expect(state.run?.state).toBe('RUN_FAILED');
    },
  );

  it('provisions nothing at all for an adapter-only Run', async () => {
    const state = store(adapterPlan());
    const browser = new FakeBrowser();
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: false,
      deferred: false,
    });
    expect(browser.created).toEqual([]);
    // No row is written at all: an adapter-only Run must be unchanged by this story.
    expect(state.checkpoint).toBeNull();
    expect(state.events).toEqual([]);
  });

  it('creates exactly one workspace, bound to the Run, with its identity on the checkpoint', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari' });
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: true,
      deferred: false,
    });
    expect(browser.created).toEqual(['ws-1']);
    expect(state.checkpoint).toMatchObject({
      status: 'OPEN',
      workspaceId: 'ws-1',
      mode: 'solari',
      attempts: 1,
      stepId: 'session-1',
      diagnostic: null,
    });
    // The frozen `create-workspace` step, as Step Execution provenance.
    expect(state.executions).toEqual([
      expect.objectContaining({ action: 'create-workspace', planStepId: 'session-1', state: 'SUCCEEDED', workItemId: null }),
    ]);
    const event = state.events.at(-1);
    expect(event?.eventType).toBe('lifecycle.agent-workspace');
    expect(event?.payload).toMatchObject({
      diagnostic: 'workspace-created',
      workspaceReference: `workspace-${RUN.runId}`,
      mode: 'solari',
      stepId: 'session-1',
    });
  });

  it('reattaches to the workspace it left rather than making a second one', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ attachable: true });
    await provisionWorkspace(DEPS(state, browser), JOB);
    // A lease that expired: the same Run is claimed again by the recovery sweep.
    state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };
    await provisionWorkspace(DEPS(state, browser), JOB);
    expect(browser.created).toEqual(['ws-1']);
    expect(browser.attached).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'local' }]);
    expect(state.checkpoint).toMatchObject({ workspaceId: 'ws-1', status: 'OPEN', attempts: 2 });
    expect(state.events.at(-1)?.payload).toMatchObject({ diagnostic: 'workspace-reattached' });
  });

  it('does not spend the Session Step budget reattaching to a healthy workspace', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ attachable: true });
    // `acquirePopulation` asks for a redelivery on any transient transport failure and has
    // four attempts of its own, so a Run that retried its population three times arrives
    // here four times with a workspace that was fine every time. Counting those against the
    // provisioning budget would fail the Run on the fifth.
    for (let redelivery = 0; redelivery < 6; redelivery += 1) {
      expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
        retry: false,
        provisioned: true,
        deferred: false,
      });
    }
    expect(browser.created).toEqual(['ws-1']);
    expect(state.checkpoint).toMatchObject({ status: 'OPEN', attempts: 1, workspaceId: 'ws-1' });
    expect(state.run?.state).toBe('RUNNING');
  });

  it('releases the stale identity before replacing a workspace it cannot reattach to', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ attachable: false });
    await provisionWorkspace(DEPS(state, browser), JOB);
    state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: true,
      deferred: false,
      workspaceReplaced: true,
    });
    // Never a second workspace held at once: the stale one is given back first.
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'local' }]);
    expect(browser.created).toEqual(['ws-1', 'ws-2']);
    expect(state.checkpoint).toMatchObject({ workspaceId: 'ws-2', status: 'OPEN' });
    expect(state.events.at(-1)?.payload).toMatchObject({ diagnostic: 'workspace-reattach-failed' });
  });

  it('makes no replacement when the stale release FAILS, and keeps the identity', async () => {
    const state = store(agentPlan());
    // Three facts at once, which is the point: the reattach is impossible, giving the
    // stale identity back FAILS, and a replacement is therefore attempted over the top of
    // the only durable record of a session that may still be running.
    const browser = new FakeBrowser({
      attachable: false,
      failRelease: new Error('the provider did not answer'),
    });
    await provisionWorkspace(DEPS(state, browser), JOB);
    expect(state.checkpoint).toMatchObject({ workspaceId: 'ws-1' });
    state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };

    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: true,
      provisioned: false,
      deferred: false,
    });
    // The release was ATTEMPTED, and it failed. The adapter resolves an identity the
    // provider no longer knows about as success, so a throw is an outage or a refusal and
    // the workspace is very possibly still held.
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'local' }]);
    // No second workspace was made — the whole reason the release comes first.
    expect(browser.created).toEqual(['ws-1']);
    // And `ws-1` is still on the row. Overwriting it would leave nothing anywhere able to
    // name that session: the reaper reads `run_workspace`, and this is that row.
    expect(state.checkpoint).toMatchObject({
      status: 'RETRY',
      workspaceId: 'ws-1',
      diagnostic: 'workspace-release-failed',
    });
    expect(state.run?.state).toBe('RUNNING');
    expect(state.events.at(-1)?.payload).toMatchObject({
      diagnostic: 'workspace-release-failed',
      workspaceReference: `workspace-${RUN.runId}`,
    });
  });

  it('still names the workspace once the budget is spent, so the reaper can find it', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({
      attachable: false,
      failRelease: new Error('the provider did not answer'),
    });
    await provisionWorkspace(DEPS(state, browser), JOB);
    for (const attempt of [2, 3]) {
      state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };
      expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
        retry: true,
        provisioned: false,
        deferred: false,
      });
      expect(state.checkpoint).toMatchObject({ status: 'RETRY', attempts: attempt, workspaceId: 'ws-1' });
    }
    state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: false,
      deferred: false,
    });
    // §E: a Run-level Session Step failing after bounded retries is RUN_FAILED — and the
    // row STILL names the workspace nothing could give back. That is the property that
    // matters: `reapableRunIds` selects a FAILED row that names one whose Run has ended.
    expect(state.checkpoint).toMatchObject({
      status: 'FAILED',
      attempts: 4,
      workspaceId: 'ws-1',
      diagnostic: 'workspace-release-failed',
    });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(browser.created).toEqual(['ws-1']);
  });

  it('replaces an EXPIRED workspace even when the release fails, because nothing can leak', async () => {
    const state = store(agentPlan());
    // The two paths must not be collapsed. Past the provider's HARD deadline the session
    // has auto-released itself, so the release is a courtesy and its failure means the
    // identity was already gone — which is the outcome asked for. A replacement is right.
    const browser = new FakeBrowser({
      attachable: true,
      expiresAt: '2026-09-05T00:00:00.000Z',
      failRelease: new Error('the provider did not answer'),
    });
    await provisionWorkspace(DEPS(state, browser), JOB);
    state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: true,
      deferred: false,
      workspaceReplaced: true,
    });
    // Nothing is attached to past the deadline, and the replacement is made regardless.
    expect(browser.attached).toEqual([]);
    expect(browser.created).toEqual(['ws-1', 'ws-2']);
    expect(state.checkpoint).toMatchObject({ status: 'OPEN', workspaceId: 'ws-2' });
    expect(state.events.at(-1)?.payload).toMatchObject({ diagnostic: 'workspace-expired' });
  });

  it('retries an outage under the Session Step budget and fails the Run when it is spent', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ failCreate: new WorkspaceProvisionError('unavailable') });
    for (const attempt of [1, 2, 3]) {
      expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
        retry: true,
        provisioned: false,
        deferred: false,
      });
      expect(state.checkpoint).toMatchObject({
        status: 'RETRY',
        attempts: attempt,
        diagnostic: 'workspace-unavailable',
      });
      expect(state.run?.state).toBe('RUNNING');
    }
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: false,
      deferred: false,
    });
    // §E: a Run-level Session Step failing after bounded retries is RUN_FAILED.
    expect(state.checkpoint).toMatchObject({ status: 'FAILED', attempts: 4 });
    expect(state.run?.state).toBe('RUN_FAILED');
    // The Result is sealed in the same transition, which generation 25 requires.
    expect(state.result?.runState).toBe('RUN_FAILED');
    expect(state.executions.filter((entry) => entry.state === 'FAILED')).toHaveLength(4);
  });

  it('does not spend the budget on a provider refusal, which will refuse again', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ failCreate: new WorkspaceProvisionError('entitlement') });
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: false,
      deferred: false,
    });
    expect(state.checkpoint).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      diagnostic: 'workspace-entitlement',
    });
    expect(state.run?.state).toBe('RUN_FAILED');
  });

  it('fails a plan that names an agent Target with no frozen create-workspace step', async () => {
    const plan = agentPlan();
    const state = store({ ...plan, sessionSteps: plan.sessionSteps.slice(1) } as ExecutablePlan);
    const browser = new FakeBrowser();
    await provisionWorkspace(DEPS(state, browser), JOB);
    expect(browser.created).toEqual([]);
    expect(state.checkpoint).toMatchObject({ status: 'FAILED', diagnostic: 'unsupported-frozen-plan' });
    expect(state.run?.state).toBe('RUN_FAILED');
  });

  it('fails closed on a provider reason this build has never heard of', async () => {
    const state = store(agentPlan());
    // `SolariErrorCode` is widened with `| string`, so a later provider release can name a
    // reason this build does not know. Treating it as an outage would retry it four times
    // against a wall; treating it as a refusal records it and stops.
    const browser = new FakeBrowser({
      failCreate: new WorkspaceProvisionError('quota-exhausted-in-2029' as never),
    });
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: false,
      deferred: false,
    });
    expect(state.checkpoint).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      diagnostic: 'workspace-refused',
    });
    expect(state.run?.state).toBe('RUN_FAILED');
  });

  it('treats a session past the provider deadline as gone, not as an outage', async () => {
    const state = store(agentPlan());
    // A deadline already in the past when the resumed claim looks at it.
    const browser = new FakeBrowser({ attachable: true, expiresAt: '2026-09-05T00:00:00.000Z' });
    await provisionWorkspace(DEPS(state, browser), JOB);
    expect(state.checkpoint).toMatchObject({ expiresAt: '2026-09-05T00:00:00.000Z' });
    state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };
    await provisionWorkspace(DEPS(state, browser), JOB);
    // The provider auto-releases at its own deadline, so nothing is attached to: the
    // identity is given back and a new workspace is made, and the chain says which it was.
    expect(browser.attached).toEqual([]);
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'local' }]);
    expect(browser.created).toEqual(['ws-1', 'ws-2']);
    expect(state.events.at(-1)?.payload).toMatchObject({ diagnostic: 'workspace-expired' });
  });

  it('records every denied destination as a security event', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({
      denials: [
        { destination: 'https://elsewhere.invalid/steal', method: 'GET', resourceType: 'document' },
      ],
    });
    await provisionWorkspace(DEPS(state, browser), JOB);
    const denial = state.events.find((entry) => entry.eventType === 'security.action-denied');
    expect(denial?.outcome).toBe('denied');
    expect(denial?.payload).toMatchObject({
      cause: 'scope-violation',
      diagnostic: 'workspace-egress-denied',
      destination: 'https://elsewhere.invalid/steal',
      method: 'GET',
      resourceType: 'document',
    });
    expect(state.events.at(-2)?.payload).toMatchObject({ deniedTotal: 1 });
  });
});

describe('releaseWorkspace', () => {
  it('keeps the workspace while the Run can still act', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ attachable: true });
    await provisionWorkspace(DEPS(state, browser), JOB);
    state.run = { ...state.run!, state: 'RUNNING' };
    expect(await releaseWorkspace(DEPS(state, browser), RUN.runId)).toEqual({ released: false });
    expect(browser.released).toEqual([]);
    expect(state.checkpoint?.status).toBe('OPEN');
  });

  it('releases it once the Run has ended, and is idempotent', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ attachable: true });
    await provisionWorkspace(DEPS(state, browser), JOB);
    state.run = { ...state.run!, state: 'RUN_FAILED' };
    expect(await releaseWorkspace(DEPS(state, browser), RUN.runId)).toEqual({ released: true });
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'local' }]);
    expect(state.checkpoint).toMatchObject({
      status: 'RELEASED',
      releasedAt: '2026-09-06T00:00:00.000Z',
    });
    expect(state.events.at(-1)?.payload).toMatchObject({ diagnostic: 'workspace-released' });
    // A second release does nothing at all, and adds no second event.
    const events = state.events.length;
    expect(await releaseWorkspace(DEPS(state, browser), RUN.runId)).toEqual({ released: false });
    expect(browser.released).toHaveLength(1);
    expect(state.events).toHaveLength(events);
  });

  it('closes an expired Solari workspace when its provider release fails', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({
      mode: 'solari',
      expiresAt: '2026-09-05T00:00:00.000Z',
      failRelease: new Error('the provider is unavailable'),
    });
    await provisionWorkspace(DEPS(state, browser), JOB);
    state.run = { ...state.run!, state: 'RUN_FAILED' };

    expect(await releaseWorkspace(DEPS(state, browser), RUN.runId)).toEqual({ released: true });
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'solari' }]);
    expect(state.checkpoint).toMatchObject({
      status: 'RELEASED',
      workspaceId: 'ws-1',
      mode: 'solari',
      expiresAt: '2026-09-05T00:00:00.000Z',
      diagnostic: 'workspace-expired',
    });
    expect(state.events.at(-1)?.payload).toMatchObject({
      diagnostic: 'workspace-expired',
      workspaceReference: `workspace-${RUN.runId}`,
    });
  });

  it('defers, by name, while another claimant holds a live provisioning lease', async () => {
    // The queue's delivery and the population recovery sweep can both reach a Run inside
    // the seconds a provider session takes to create. The loser used to get the same
    // `null` an adapter-only Run gets, carried on to acquire the population, and the agent
    // claim then ended the Run `workspace-missing` (2026-09-16, production). It is told
    // by name now, creates nothing, and writes nothing: the lease holder carries the Run.
    const state = store(agentPlan());
    state.checkpoint = {
      revision: 1,
      status: 'PROVISIONING',
      attempts: 1,
      stepId: 'session-1',
      workspaceId: null,
      expiresAt: null,
      mode: 'local',
      startedAt: '2026-09-06T00:00:00.000Z',
      attemptStartedAt: '2026-09-06T00:00:00.000Z',
      leaseUntil: '2026-09-06T00:02:00.000Z',
      releasedAt: null,
      diagnostic: null,
    };
    const browser = new FakeBrowser();
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({ retry: false, provisioned: false, deferred: true });
    expect(browser.created).toEqual([]);
    expect(state.checkpoint).toMatchObject({ status: 'PROVISIONING', revision: 1 });
    // Unchanged: the claim is the Run's first boundary and this caller never took it.
    expect(state.run?.state).toBe('QUEUED');
  });

  it('closes a row that names no workspace rather than sweeping it forever', async () => {
    const state = store(agentPlan(), { ...RUN, state: 'RUN_FAILED' });
    state.checkpoint = {
      revision: 1,
      status: 'PROVISIONING',
      attempts: 1,
      stepId: 'session-1',
      workspaceId: null,
      expiresAt: null,
      mode: 'local',
      startedAt: '2026-09-06T00:00:00.000Z',
      attemptStartedAt: '2026-09-06T00:00:00.000Z',
      leaseUntil: '2026-09-06T00:02:00.000Z',
      releasedAt: null,
      diagnostic: null,
    };
    const browser = new FakeBrowser();
    expect(await releaseWorkspace(DEPS(state, browser), RUN.runId)).toEqual({ released: false });
    expect(browser.released).toEqual([]);
    expect(state.checkpoint).toMatchObject({ status: 'RELEASED' });
  });
});
