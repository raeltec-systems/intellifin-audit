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
} from '@intellifin/domain';

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
  cancellation: null,
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

describe('provisionWorkspace', () => {
  it('provisions nothing at all for an adapter-only Run', async () => {
    const state = store(adapterPlan());
    const browser = new FakeBrowser();
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: false,
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
      workspaceId: 'ws-1',
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
    await provisionWorkspace(DEPS(state, browser), JOB);
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
      workspaceId: 'ws-1',
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
      });
      expect(state.checkpoint).toMatchObject({ status: 'RETRY', attempts: attempt, workspaceId: 'ws-1' });
    }
    state.checkpoint = { ...state.checkpoint!, status: 'RETRY' };
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      provisioned: false,
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
