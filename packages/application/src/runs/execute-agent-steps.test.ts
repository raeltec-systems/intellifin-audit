import { describe, expect, it } from 'vitest';
import {
  bindingDigest,
  utf8Bytes,
  bindingDigestEnvelope,
  bytesDiscloseCompiled,
  compileSecret,
  redactCompiled,
  REDACTED_CREDENTIAL,
  deriveExecutablePlan,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  registrationDigest,
  snapshotFromRegistration,
  type ExecutablePlan,
  type PackageArtifact,
  type RunRecord,
  type RunResultConditionCount,
  type RunResultExclusion,
  type RunResultFindings,
  type SanitizedToolAction,
  type RunCancellationRequest,
  WEB_TREE_MEDIA_TYPE,
} from '@intellifin/domain';

import { canExecuteWithoutAuditCredentials, executeAgentSteps, performToolAction } from './execute-agent-steps.js';
import { NO_CREDENTIALS, guardedCredentials } from './credential-guard.js';
import {
  BrowserActionError,
  type AgentExecutionCheckpoint,
  type AgentExecutionContext,
  type AgentExecutionRepository,
  type BrowserActionResult,
  type BrowserActionArtifact,
  type BrowserExecution,
  type BrowserToolAction,
  type CredentialResolver,
  type GateCheckRow,
  type PackageSeal,
  type ResolvedCredential,
  type RunGatePopulationFacts,
  type SessionStepRecord,
  type StepExecutionRecord,
  type StoredRunResult,
  type WorkspaceRef,
} from './execution-ports.js';

/**
 * The agent execution phase over a fake repository and a fake browser (Story 4.2).
 *
 * `tests/integration/agent-execution.test.ts` drives the same command against PostgreSQL,
 * and `tests/e2e/agent-sign-in.spec.ts` drives the real worker against the real synthetic
 * LoanCore. What is pinned HERE is every row of the story's own I/O matrix, including the
 * ones a real system cannot be made to produce on demand: a gate denial before anything
 * leaves, a Target System that refuses, and a redirect out of the frozen origins.
 */

const TOKEN = 'synthetic-test-token-never-store-me';
const CREDENTIAL_REF = 'cred://synthetic/loancore-readonly';
const ORIGIN = 'https://loancore.synthetic.invalid/loancore';

const RUN: RunRecord = {
  runId: '01a06fd8-0000-7000-8000-0000000001f1',
  correlationId: '01a06fd8-0000-7000-8000-0000000001f2',
  procedureId: '01a06fd8-0000-7000-8000-0000000001f3',
  versionId: '01a06fd8-0000-7000-8000-0000000001f4',
  versionNumber: 1,
  procedureName: 'Terminated users retaining access',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-06T00:00:00.000Z',
  authorizationRole: 'auditor',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null,
  requestToken: '01a06fd8-0000-7000-8000-0000000001f5',
};

const JOB = { schemaVersion: 1 as const, runId: RUN.runId, correlationId: RUN.correlationId };

/** A real compiler-1 plan, derived rather than hand-built. */
function planFor(
  kind: 'web' | 'api' | 'desktop',
  authenticationDestination?: string,
): ExecutablePlan {
  const registration = {
    registrationId: '018f0000-0000-7000-8000-0000000001a1',
    displayName: 'LoanCore',
    kind,
    allowedOrigins: kind === 'desktop' ? [] : [ORIGIN],
    applicationIdentity: kind === 'desktop' ? 'com.northstar.ledgerdesk' : '',
    credentialRef: CREDENTIAL_REF,
    permittedActions:
      kind === 'api'
        ? (['list-records', 'read-attribute'] as const)
        : (['navigate', 'search', 'open-record', 'read-attribute'] as const),
    attributeLabelPatterns: ['Status', 'Username'],
    secondaryKey: 'Full name',
    ...(authenticationDestination === undefined ? {} : { authenticationDestination }),
  };
  const source = {
    kind: 'versioned-file' as const,
    location: 'https://synthetic.invalid/accounts.csv',
    declaredSchema: ['account_id', 'status'],
    sensitiveFields: [],
    declaredCountMechanism: 'cover-sheet' as const,
  };
  const derived = deriveExecutablePlan({
    ...initialDraftPopulation('P-2'),
    ...initialDraftCompliance('P-2'),
    ...initialDraftEvidence('P-2'),
    templateId: 'P-2',
    controlName: 'Terminated users retaining access',
    sections: initialDraftSections('P-2'),
    scope: 'All accounts',
    period: { from: '2026-08-01', to: '2026-08-31' },
    sourceSnapshot: {
      bindingId: '018f0000-0000-7000-8000-000000000199',
      displayName: 'Accounts',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    },
    schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' },
    targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
    instructions:
      kind === 'api' ? [] : [{ registrationId: registration.registrationId, text: 'Read the account.' }],
  });
  if (!derived.ok) throw new Error(derived.reason);
  return derived.plan;
}

const PUBLIC_LABELS = [
  'Parameter',
  'Value',
  'Snapshot identifier',
  'Expected parameter count',
  'Snapshot taken at',
] as const;

/** Keep the execution fixture small while changing only the frozen P-4 target contract. */
function publicPlan(labels: readonly string[] = PUBLIC_LABELS): ExecutablePlan {
  const base = planFor('web');
  const target = base.inputs.targets[0]!;
  return {
    ...base,
    inputs: {
      ...base.inputs,
      templateId: 'P-4',
      targets: [{
        ...target,
        contract: { ...target.contract, attribute_label_patterns: labels },
      }],
    },
  } as ExecutablePlan;
}

function publicArtifact(
  nodes: readonly Record<string, unknown>[] = [
    { group: 'page', role: 'link', label: 'Production configuration', value: 'Production configuration', target: `${ORIGIN}/configuration` },
  ],
): BrowserActionArtifact {
  return {
    kind: 'structural-snapshot',
    bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes })),
    mediaType: WEB_TREE_MEDIA_TYPE,
    location: ORIGIN,
  };
}

describe('credentialless public P-4 eligibility', () => {
  it('accepts the seeded single-web public contract with its retained decoy reference', () => {
    // The registration contract keeps its required opaque credential reference for
    // digest/plan compatibility. Public eligibility is keyed by the frozen P-4 contract
    // and absent authentication destination, so this reference must never be resolved.
    expect(canExecuteWithoutAuditCredentials(publicPlan())).toBe(true);
  });

  it('rejects an absent or unsupported frozen plan', () => {
    expect(canExecuteWithoutAuditCredentials(null)).toBe(false);
    expect(
      canExecuteWithoutAuditCredentials({
        ...publicPlan(),
        schemaVersion: 2,
      } as unknown as ExecutablePlan),
    ).toBe(false);
  });

  it('rejects an extra frozen target', () => {
    const plan = publicPlan();
    const target = plan.inputs.targets[0]!;
    expect(
      canExecuteWithoutAuditCredentials({
        ...plan,
        inputs: {
          ...plan.inputs,
          targets: [
            target,
            { ...target, registrationId: '018f0000-0000-7000-8000-0000000001a2', displayName: 'Second Target' },
          ],
        },
      } as unknown as ExecutablePlan),
    ).toBe(false);
  });

  it('rejects a frozen adapter target', () => {
    const plan = publicPlan();
    const target = plan.inputs.targets[0]!;
    expect(
      canExecuteWithoutAuditCredentials({
        ...plan,
        inputs: {
          ...plan.inputs,
          targets: [{ ...target, contract: { ...target.contract, kind: 'api' } }],
        },
      } as unknown as ExecutablePlan),
    ).toBe(false);
  });

  it('rejects a frozen desktop target', () => {
    const plan = publicPlan();
    const target = plan.inputs.targets[0]!;
    expect(
      canExecuteWithoutAuditCredentials({
        ...plan,
        inputs: {
          ...plan.inputs,
          targets: [{ ...target, contract: { ...target.contract, kind: 'desktop' } }],
        },
      } as unknown as ExecutablePlan),
    ).toBe(false);
  });

  it('rejects a public contract with a configured authentication destination', () => {
    const plan = publicPlan();
    const target = plan.inputs.targets[0]!;
    expect(
      canExecuteWithoutAuditCredentials({
        ...plan,
        inputs: {
          ...plan.inputs,
          targets: [{
            ...target,
            contract: { ...target.contract, authentication_destination: `${ORIGIN}/sign-in` },
          }],
        },
      } as unknown as ExecutablePlan),
    ).toBe(false);
  });

  it('rejects a public contract missing one registered page label', () => {
    expect(canExecuteWithoutAuditCredentials(publicPlan(PUBLIC_LABELS.slice(1)))).toBe(false);
  });

  it('rejects an unexpected registered page label', () => {
    expect(canExecuteWithoutAuditCredentials(publicPlan([...PUBLIC_LABELS, 'Unexpected']))).toBe(false);
  });
});

interface Store {
  run: RunRecord | null;
  checkpoint: AgentExecutionCheckpoint | null;
  plan: ExecutablePlan | null;
  populationReady: boolean;
  workspace: { workspaceId: string; mode: string } | null;
  steps: SessionStepRecord[];
  executions: StepExecutionRecord[];
  actions: SanitizedToolAction[];
  events: { eventType: string; outcome: string; payload: Record<string, unknown> }[];
  states: RunRecord['state'][];
  seal: PackageSeal | null;
  result: StoredRunResult | null;
}

function store(plan: ExecutablePlan | null, overrides: Partial<Store> = {}): Store {
  return {
    run: { ...RUN },
    checkpoint: null,
    plan,
    populationReady: true,
    workspace: { workspaceId: 'ws-1', mode: 'local' },
    steps: [],
    executions: [],
    actions: [],
    events: [],
    states: [],
    seal: null,
    result: null,
    ...overrides,
  };
}

class FakeContext implements AgentExecutionContext {
  run: RunRecord | null;
  /** The cancellation marker `completeRun` reads on the transaction's own connection
   * (Epic 3). `null` is "nobody asked", which is every agent-execution test here. */
  cancellation: RunCancellationRequest | null = null;
  readCancellation = async (): Promise<RunCancellationRequest | null> => this.cancellation;
  checkpoint: AgentExecutionCheckpoint | null;
  populationStartedAt: string | null;
  populationReady: boolean;
  workspace: { workspaceId: string; mode: string } | null;
  sessionSteps: readonly SessionStepRecord[];
  private sequence = 0;

  constructor(private readonly state: Store) {
    this.run = state.run;
    this.checkpoint = state.checkpoint;
    this.populationStartedAt = '2026-09-06T00:00:00.000Z';
    this.populationReady = state.populationReady;
    this.workspace = state.workspace;
    this.sessionSteps = state.steps.map((step) => ({ ...step }));
  }

  auditEvents = {
    append: async (draft: {
      eventType: string;
      outcome: string;
      payload: Record<string, unknown>;
    }) => {
      this.sequence += 1;
      this.state.events.push({
        eventType: draft.eventType,
        outcome: draft.outcome,
        payload: draft.payload,
      });
      return { sequence: this.sequence } as never;
    },
  };

  frozenPlan = async (): Promise<ExecutablePlan | null> => this.state.plan;
  saveCheckpoint = async (
    checkpoint: AgentExecutionCheckpoint,
    state: RunRecord['state'],
  ): Promise<void> => {
    this.state.checkpoint = { ...checkpoint };
    this.state.run = this.state.run === null ? null : { ...this.state.run, state };
    this.state.states.push(state);
  };
  saveSessionStep = async (step: SessionStepRecord): Promise<void> => {
    const index = this.state.steps.findIndex((row) => row.stepId === step.stepId);
    if (index < 0) this.state.steps.push({ ...step });
    else this.state.steps[index] = { ...step };
  };
  saveStepExecution = async (execution: StepExecutionRecord): Promise<void> => {
    const index = this.state.executions.findIndex(
      (row) => row.stepExecutionId === execution.stepExecutionId,
    );
    if (index < 0) this.state.executions.push({ ...execution });
    else this.state.executions[index] = { ...execution };
  };
  saveToolAction = async (action: SanitizedToolAction): Promise<void> => {
    this.state.actions.push(action);
  };
  readStepExecutionCount = async (): Promise<number> => this.state.executions.length;

  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => [];
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => this.state.seal;
  writeSeal = async (seal: PackageSeal): Promise<void> => {
    this.state.seal = seal;
  };
  notifyTimeline = async (): Promise<void> => undefined;
  readGateChecks = async (): Promise<readonly GateCheckRow[]> => [];
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    this.state.run = this.state.run === null ? null : { ...this.state.run, state };
  };
  readPopulationFacts = async (): Promise<RunGatePopulationFacts | null> => null;
  readPopulationRows = async () => [];
  readGateObservations = async () => [];
  readResult = async (): Promise<StoredRunResult | null> => this.state.result;
  writeResult = async (result: StoredRunResult): Promise<void> => {
    this.state.result = result;
  };
  readResultExclusions = async (): Promise<readonly RunResultExclusion[]> => [];
  readConditionCounts = async (): Promise<readonly RunResultConditionCount[]> => [];
  readResultFindings = async (): Promise<{
    exceptions: RunResultFindings;
    unevaluated: RunResultFindings;
  }> => ({ exceptions: { total: 0, records: [] }, unevaluated: { total: 0, records: [] } });
}

function repository(state: Store): AgentExecutionRepository {
  return {
    transaction: async (_runId, work) => work(new FakeContext(state)),
    recoverableRunIds: async () => [],
  };
}

interface FakeBrowserOptions {
  readonly result?: Partial<BrowserActionResult>;
  readonly fail?: BrowserActionError | null;
  /** Fail this many times, then succeed. */
  readonly failTimes?: number;
}

class FakeBrowser implements BrowserExecution {
  readonly mode = 'local' as const;
  readonly performed: BrowserToolAction[] = [];
  /**
   * Every value the credential was allowed to type into a form field. Proves the port
   * received it — a sign-in submits the Target System's own form, so the credential
   * leaves through `enter` rather than through a header.
   */
  readonly entered: string[] = [];
  private failures = 0;

  constructor(private readonly options: FakeBrowserOptions = {}) {}

  create = (): Promise<never> => Promise.reject(new BrowserActionError('unavailable'));
  attach = (): Promise<null> => Promise.resolve(null);
  release = (): Promise<void> => Promise.resolve();

  perform = async (
    _ref: WorkspaceRef,
    action: BrowserToolAction,
  ): Promise<BrowserActionResult> => {
    this.performed.push(action);
    action.credential?.enter({ set: (value) => this.entered.push(value) });
    if (this.options.fail && this.failures < (this.options.failTimes ?? Number.MAX_SAFE_INTEGER)) {
      this.failures += 1;
      throw this.options.fail;
    }
    return {
      status: 200,
      // What the real workspace reports for a sign-in: the method of the request that
      // produced the final response, which is the form's own `POST`.
      method: action.credential === null ? 'GET' : 'POST',
      location: `${ORIGIN}/`,
      redirected: action.credential !== null,
      downloads: 0,
      session: true,
      ...this.options.result,
    };
  };
}

/**
 * A resolved credential shaped exactly like the real one.
 *
 * `redact` and `discloses` go through the DOMAIN functions the infrastructure factory uses,
 * rather than being stubbed to the identity: a stub would make every test that asserts a
 * destination or an artifact pass against an implementation that redacts nothing.
 */
function credential(reference = CREDENTIAL_REF, token = TOKEN): ResolvedCredential {
  const secret = compileSecret(token);
  return {
    reference,
    authorize(headers) {
      headers.set('authorization', `Bearer ${token}`);
    },
    enter(field) {
      field.set(token);
    },
    redact: (text) => redactCompiled(text, secret),
    discloses: (bytes) => bytesDiscloseCompiled(bytes, secret),
  };
}

function resolver(overrides: Partial<CredentialResolver> = {}): CredentialResolver {
  return { resolve: async (reference) => credential(reference), ...overrides };
}

let counter = 0;
const DEPS = (state: Store, browser: BrowserExecution, credentials = resolver()) => ({
  repository: repository(state),
  browser,
  credentials,
  clock: { now: () => new Date('2026-09-06T00:05:00.000Z') },
  ids: { next: () => `01a06fd8-0000-7000-8000-${String((counter += 1)).padStart(12, '0')}` },
});

describe('a Run with no agent-driven Target System', () => {
  it('writes nothing and lets the Run proceed', async () => {
    const state = store(planFor('api'));
    const browser = new FakeBrowser();
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      proceed: true,
    });
    expect(state.checkpoint).toBeNull();
    expect(state.steps).toEqual([]);
    expect(state.events).toEqual([]);
    expect(browser.performed).toEqual([]);
  });
});

describe('the sign-in Session Step', () => {
  it('establishes the session, and the step is ACQUIRED with no Evidence', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser();
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      proceed: true,
    });
    expect(state.checkpoint).toMatchObject({ status: 'SIGNED_IN', diagnostic: null });
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({
      action: 'sign-in',
      state: 'ACQUIRED',
      attempts: 1,
      // A sign-in freezes no bytes. The `run_session_step_acquired` CHECK is what would
      // otherwise refuse exactly this row, which is why it reads the action.
      evidenceId: null,
    });
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0]).toMatchObject({ action: 'sign-in', state: 'SUCCEEDED' });
    // The Run is still RUNNING: nothing here concludes it.
    expect(state.run?.state).toBe('RUNNING');
    expect(state.result).toBeNull();
  });

  it('navigates to the FROZEN origin, carrying the credential the plan named', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser();
    await executeAgentSteps(DEPS(state, browser), JOB);
    expect(browser.performed).toHaveLength(1);
    expect(browser.performed[0]).toMatchObject({ action: 'navigate', destination: ORIGIN });
    expect(browser.performed[0]?.credential?.reference).toBe(CREDENTIAL_REF);
    // The credential reaches the WIRE and nowhere else: the port is what types it into the
    // Target System's own sign-in form.
    expect(browser.entered).toEqual([TOKEN]);
  });

  it('passes the exact frozen authentication destination to the browser caller', async () => {
    const state = store(planFor('web', `${ORIGIN}/sign-in`));
    const browser = new FakeBrowser();

    await expect(executeAgentSteps(DEPS(state, browser), JOB)).resolves.toEqual({
      retry: false,
      proceed: true,
    });
    expect(browser.performed[0]).toMatchObject({
      action: 'navigate',
      destination: ORIGIN,
      authenticationDestination: `${ORIGIN}/sign-in`,
    });
  });

  it('records the action in the shared sanitized log, with no credential in it', async () => {
    const state = store(planFor('web'));
    await executeAgentSteps(DEPS(state, new FakeBrowser()), JOB);
    expect(state.actions).toHaveLength(1);
    expect(state.actions[0]).toMatchObject({
      surface: 'agent',
      action: 'navigate',
      // The method the workspace ENDED on: a sign-in submits the system's own form, so the
      // log says `POST`. Recording the `GET` it started with would leave the submission
      // invisible in the one record a reader checks the read-only guarantee against.
      method: 'POST',
      outcome: 'performed',
      denial: null,
      offending: null,
      status: 200,
      // The system answered the submission with a redirect the browser followed.
      redirected: true,
      downloads: 0,
      parameters: [],
      workItemId: null,
    });
    expect(JSON.stringify(state.actions)).not.toContain(TOKEN);
    // The Step Execution the action belongs to actually exists.
    expect(state.executions.map((row) => row.stepExecutionId)).toContain(
      state.actions[0]?.stepExecutionId,
    );
  });

  it('records the sign-in as a credential-entry action whose capture was SUPPRESSED', async () => {
    // Story 4.3. The action is on the log, and its row SAYS capture was suppressed and
    // why. A missing artifact with no explanation reads to an auditor as "nothing happened
    // here" — the defect class this codebase keeps finding — so the suppression is a
    // recorded fact rather than an absence to be inferred.
    const state = store(planFor('web'));
    await executeAgentSteps(DEPS(state, new FakeBrowser()), JOB);
    expect(state.actions[0]).toMatchObject({
      capture: 'SUPPRESSED',
      captureSuppression: 'credential-entry',
    });
  });

  it('asks the port for no capture at all while the credential is on the wire', async () => {
    // The union is the guarantee — a credential-carrying `BrowserToolAction` has no
    // `capture` field, so this does not compile the other way — and this is what proves the
    // stage takes the arm it says it does.
    const browser = new FakeBrowser();
    await executeAgentSteps(DEPS(store(planFor('web')), browser), JOB);
    const [performed] = browser.performed;
    expect(performed?.credential).not.toBeNull();
    expect((performed as { capture?: unknown } | undefined)?.capture).toBeUndefined();
  });

  it('redacts the credential out of a destination before it is recorded', async () => {
    // `sanitizeDestination` strips the query and `user:pass@` and keeps the PATH, so a
    // Target System that put the token in a path segment — or a redirect that did — would
    // otherwise put it into the immutable chain. Same doctrine one step along: a
    // destination denied FOR carrying a credential must still be recorded, without it.
    const browser = new FakeBrowser({ result: { location: `${ORIGIN}/session/${TOKEN}` } });
    const state = store(planFor('web'));
    await executeAgentSteps(DEPS(state, browser), JOB);
    expect(state.actions[0]?.destination).toBe(`${ORIGIN}/session/${REDACTED_CREDENTIAL}`);
    expect(JSON.stringify(state.actions)).not.toContain(TOKEN);
  });

  it('audits the retrieval by naming the Target System, never the credential reference', async () => {
    const state = store(planFor('web'));
    await executeAgentSteps(DEPS(state, new FakeBrowser()), JOB);
    const established = state.events.find(
      (event) => event.payload['diagnostic'] === 'session-established',
    );
    expect(established).toBeDefined();
    expect(established?.payload['registrationId']).toBe('018f0000-0000-7000-8000-0000000001a1');
    // `FORBIDDEN_PAYLOAD_KEYS` refuses a credential-shaped key outright, so the chain
    // cannot hold one — but the reference must not be there under another name either.
    const serialized = JSON.stringify(state.events);
    expect(serialized).not.toContain(CREDENTIAL_REF);
    expect(serialized).not.toContain(TOKEN);
  });

  it('is idempotent: a second delivery signs in again for nobody', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser();
    await executeAgentSteps(DEPS(state, browser), JOB);
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      proceed: true,
    });
    expect(browser.performed).toHaveLength(1);
    expect(state.actions).toHaveLength(1);
  });

  it('forces a fresh positive sign-in after a workspace replacement while preserving history', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser();
    await executeAgentSteps(DEPS(state, browser), JOB);
    const firstExecutionId = state.executions[0]?.stepExecutionId;

    expect(
      await executeAgentSteps(DEPS(state, browser), JOB, { forceReauthentication: true }),
    ).toEqual({ retry: false, proceed: true });

    expect(browser.performed).toHaveLength(2);
    expect(browser.entered).toEqual([TOKEN, TOKEN]);
    expect(state.steps[0]).toMatchObject({ state: 'ACQUIRED', attempts: 2, diagnostic: null });
    expect(state.executions).toHaveLength(2);
    expect(state.executions[0]).toMatchObject({
      stepExecutionId: firstExecutionId,
      attempt: 1,
      state: 'SUCCEEDED',
    });
    expect(state.executions[1]).toMatchObject({ attempt: 2, state: 'SUCCEEDED' });
    expect(state.actions).toHaveLength(2);
    expect(state.checkpoint).toMatchObject({ status: 'SIGNED_IN', attempts: 2 });
  });

  it('does not trust SIGNED_IN when forced reauthentication is refused', async () => {
    const state = store(planFor('web'));
    await executeAgentSteps(DEPS(state, new FakeBrowser()), JOB);
    const browser = new FakeBrowser({ result: { status: 401, session: false } });

    expect(
      await executeAgentSteps(DEPS(state, browser), JOB, { forceReauthentication: true }),
    ).toEqual({ retry: false, proceed: false });
    expect(browser.performed).toHaveLength(1);
    expect(browser.entered).toEqual([TOKEN]);
    expect(state.steps[0]).toMatchObject({
      state: 'FAILED',
      attempts: 2,
      diagnostic: 'sign-in-denied',
    });
    expect(state.checkpoint).toMatchObject({ status: 'TERMINAL' });
    expect(state.run?.state).toBe('RUN_FAILED');
  });
});

describe('the public P-4 access proof', () => {
  it('navigates without resolving the compatibility credential and validates the public landing link', async () => {
    const state = store(publicPlan());
    const browser = new FakeBrowser({ result: { artifacts: [publicArtifact()] } });
    let resolutions = 0;
    const credentials = resolver({
      resolve: async (reference) => {
        resolutions += 1;
        return credential(reference);
      },
    });

    expect(await executeAgentSteps(DEPS(state, browser, credentials), JOB)).toEqual({
      retry: false,
      proceed: true,
    });
    expect(resolutions).toBe(0);
    expect(browser.performed).toHaveLength(1);
    expect(browser.performed[0]).toMatchObject({
      action: 'navigate',
      destination: ORIGIN,
      credential: null,
      capture: ['structural-snapshot'],
    });
    expect(state.actions[0]).toMatchObject({ capture: 'PERMITTED', captureSuppression: null });
    expect(state.steps[0]).toMatchObject({ action: 'sign-in', state: 'ACQUIRED' });
    expect(state.checkpoint).toMatchObject({ status: 'SIGNED_IN' });
    expect(state.events.some((event) => event.payload['diagnostic'] === 'public-access-verified')).toBe(true);
    expect(state.events.some((event) => event.payload['diagnostic'] === 'session-established')).toBe(false);
  });

  it('rejects a public landing capture with no in-scope navigation link', async () => {
    const state = store(publicPlan());
    const browser = new FakeBrowser({ result: { artifacts: [publicArtifact([])] } });
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({ retry: false, proceed: false });
    expect(state.steps[0]).toMatchObject({ state: 'FAILED', diagnostic: 'public-access-contract-failed' });
    expect(state.checkpoint).toMatchObject({ status: 'TERMINAL', diagnostic: 'public-access-contract-failed' });
  });

  it('rejects a public landing capture whose only link is outside the frozen origin', async () => {
    const state = store(publicPlan());
    const browser = new FakeBrowser({ result: { artifacts: [publicArtifact([
      { group: 'page', role: 'link', label: 'External', value: 'External', target: 'https://elsewhere.example.test/configuration' },
    ])] } });
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({ retry: false, proceed: false });
    expect(state.steps[0]).toMatchObject({ state: 'FAILED', diagnostic: 'public-access-contract-failed' });
    expect(state.checkpoint).toMatchObject({ status: 'TERMINAL', diagnostic: 'public-access-contract-failed' });
  });

  it('fails closed on a password surface/capture contract failure without resolving credentials', async () => {
    const state = store(publicPlan());
    const browser = new FakeBrowser({ fail: new BrowserActionError('contract') });
    let resolutions = 0;
    const credentials = resolver({
      resolve: async (reference) => {
        resolutions += 1;
        return credential(reference);
      },
    });

    expect(await executeAgentSteps(DEPS(state, browser, credentials), JOB)).toEqual({
      retry: false,
      proceed: false,
    });
    expect(resolutions).toBe(0);
    expect(browser.performed[0]).toMatchObject({ credential: null, capture: ['structural-snapshot'] });
    expect(state.steps[0]).toMatchObject({ state: 'FAILED', diagnostic: 'public-access-contract-failed' });
    expect(state.checkpoint).toMatchObject({ status: 'TERMINAL', diagnostic: 'public-access-contract-failed' });
    expect(state.events.some((event) => event.payload['diagnostic'] === 'public-access-verified')).toBe(false);
    expect(state.events.some((event) => event.payload['diagnostic'] === 'session-established')).toBe(false);
  });

  it('rejects an unexpected registered label before opening a public page', async () => {
    const state = store(publicPlan([...PUBLIC_LABELS, 'Unexpected']));
    const browser = new FakeBrowser();
    let resolutions = 0;
    const credentials = resolver({
      resolve: async (reference) => {
        resolutions += 1;
        return credential(reference);
      },
    });

    expect(await executeAgentSteps(DEPS(state, browser, credentials), JOB)).toEqual({
      retry: false,
      proceed: false,
    });
    expect(resolutions).toBe(0);
    expect(browser.performed).toEqual([]);
    expect(state.steps).toEqual([]);
    expect(state.checkpoint).toMatchObject({ status: 'TERMINAL', diagnostic: 'public-access-contract-failed' });
  });
});

describe('a Target System that refuses', () => {
  it('records a 401 as a DENIAL, terminates the Run, and appends a security event', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser({ result: { status: 401, session: false } });
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      proceed: false,
    });
    // ONE attempt. Retrying a refusal proves nothing and spends the Run's frozen limits.
    expect(browser.performed).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({ state: 'FAILED', diagnostic: 'sign-in-denied' });
    expect(state.run?.state).toBe('RUN_FAILED');
    const security = state.events.filter((event) => event.eventType === 'security.action-denied');
    expect(security).toHaveLength(1);
    expect(security[0]?.payload['cause']).toBe('action-denied');
    // The action is recorded as PERFORMED with the status the system answered: the action
    // happened and the system said no, which is a different fact from a gate refusal.
    expect(state.actions[0]).toMatchObject({ outcome: 'performed', status: 401 });
  });

  it('records a redirect out of the frozen origins as a scope violation', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser({ fail: new BrowserActionError('scope') });
    await executeAgentSteps(DEPS(state, browser), JOB);
    expect(browser.performed).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({ diagnostic: 'sign-in-scope-violation', state: 'FAILED' });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(
      state.events.filter((event) => event.eventType === 'security.action-denied')[0]?.payload['cause'],
    ).toBe('scope-violation');
    expect(state.actions[0]).toMatchObject({ outcome: 'failed', denial: null });
  });

  it('RETRIES an outage under the Session Step budget, without asking the queue', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser({ fail: new BrowserActionError('unavailable'), failTimes: 1 });
    // A redelivery would re-verify the population Evidence and spend one of that stage's
    // four durable attempts, so `retry` is false and the phase's own sweep resumes it.
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      proceed: true,
    });
    expect(browser.performed).toHaveLength(2);
    expect(state.steps[0]).toMatchObject({ state: 'ACQUIRED', attempts: 2 });
    expect(state.run?.state).toBe('RUNNING');
    expect(state.events.some((event) => event.eventType === 'security.action-denied')).toBe(false);
  });

  it('fails the Run once the Session Step budget is spent', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser({ fail: new BrowserActionError('unavailable') });
    expect(await executeAgentSteps(DEPS(state, browser), JOB)).toEqual({
      retry: false,
      proceed: false,
    });
    // `sessionStepAttemptBudget` for compiler 1: three retries plus the first attempt, one
    // cycle, because §E maps a Run-level Session Step's failure to RUN_FAILED.
    expect(browser.performed).toHaveLength(4);
    expect(state.steps[0]).toMatchObject({ state: 'FAILED', attempts: 4 });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(state.result).not.toBeNull();
  });
});

describe('a credential that cannot be resolved', () => {
  it('fails the step on the FIRST attempt and never reaches the Target System', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser();
    const deps = DEPS(
      state,
      browser,
      resolver({ resolve: () => Promise.reject(new Error('no such reference')) }),
    );
    await executeAgentSteps(deps, JOB);
    expect(browser.performed).toEqual([]);
    expect(state.steps[0]).toMatchObject({ state: 'FAILED', diagnostic: 'credential-unresolved' });
    expect(state.run?.state).toBe('RUN_FAILED');
  });

  it('refuses a resolver that answers about a DIFFERENT reference', async () => {
    const state = store(planFor('web'));
    const browser = new FakeBrowser();
    const deps = DEPS(
      state,
      browser,
      resolver({ resolve: async () => credential('cred://synthetic/somebody-else') }),
    );
    await executeAgentSteps(deps, JOB);
    expect(browser.performed).toEqual([]);
    expect(state.steps[0]).toMatchObject({ diagnostic: 'credential-unresolved' });
  });
});

describe('a plan this build cannot sign in to', () => {
  it('names a desktop Target System rather than pretending to drive it', async () => {
    const state = store(planFor('desktop'));
    const browser = new FakeBrowser();
    await executeAgentSteps(DEPS(state, browser), JOB);
    expect(browser.performed).toEqual([]);
    expect(state.steps[0]).toMatchObject({ state: 'FAILED', diagnostic: 'desktop-unsupported' });
    expect(state.run?.state).toBe('RUN_FAILED');
  });

  it('fails closed when the Run holds no OPEN workspace', async () => {
    const state = store(planFor('web'), { workspace: null });
    await executeAgentSteps(DEPS(state, new FakeBrowser()), JOB);
    expect(state.checkpoint).toMatchObject({ status: 'TERMINAL', diagnostic: 'workspace-missing' });
    expect(state.run?.state).toBe('RUN_FAILED');
  });

  it('waits for the population, which the frozen order puts first', async () => {
    const state = store(planFor('web'), { populationReady: false });
    expect(await executeAgentSteps(DEPS(state, new FakeBrowser()), JOB)).toEqual({
      retry: false,
      proceed: false,
    });
    expect(state.checkpoint).toBeNull();
  });
});

describe('a person cancelled the Run', () => {
  it('honours the cancellation at the phase boundary, before anything is claimed', async () => {
    const state = store(planFor('web'), {
      run: {
        ...RUN,
        cancellation: {
          requestedBy: 'auditor',
          sessionId: 'session',
          requestedAt: '2026-09-06T00:04:00.000Z',
          reason: 'No longer needed.',
        },
      },
    });
    const browser = new FakeBrowser();
    await executeAgentSteps(DEPS(state, browser), JOB);
    expect(browser.performed).toEqual([]);
    expect(state.run?.state).toBe('CANCELED');
    expect(state.checkpoint).toBeNull();
  });
});

describe('the gate, at the port’s call site', () => {
  const ref: WorkspaceRef = { runId: RUN.runId, workspaceId: 'ws-1', mode: 'local' };
  const target = planFor('web').inputs.targets[0]!;
  const base = {
    ref,
    runId: RUN.runId,
    stepExecutionId: 'step-execution',
    workItemId: null,
    toolActionId: 'tool-action',
    credential: null,
    startedAt: '2026-09-06T00:05:00.000Z',
    completedAt: () => '2026-09-06T00:05:01.000Z',
    timeoutMs: () => 1000,
    guard: NO_CREDENTIALS,
  };

  it('denies an action outside the frozen permitted list BEFORE the port is reached', async () => {
    const browser = new FakeBrowser();
    const result = await performToolAction(browser, {
      ...base,
      scope: { target, scopeValues: new Set() },
      request: { action: 'disable', destination: ORIGIN, parameters: [] },
    });
    expect(result.ok).toBe(false);
    expect(browser.performed).toEqual([]);
    expect(result.action).toMatchObject({
      outcome: 'denied',
      denial: 'action-not-permitted',
      offending: 'disable',
      status: null,
    });
  });

  it('denies an out-of-scope origin, and records it sanitized', async () => {
    const browser = new FakeBrowser();
    const result = await performToolAction(browser, {
      ...base,
      scope: { target, scopeValues: new Set() },
      request: {
        action: 'navigate',
        destination: 'https://files.northstar-hr.synthetic.invalid/leavers?token=abc',
        parameters: [],
      },
    });
    expect(browser.performed).toEqual([]);
    expect(result.action).toMatchObject({
      outcome: 'denied',
      denial: 'origin-not-allowed',
      offending: 'https://files.northstar-hr.synthetic.invalid/leavers',
    });
    // The query string never enters the record.
    expect(JSON.stringify(result.action)).not.toContain('token=abc');
  });

  it('denies an out-of-scope PARAMETER and names it, without naming its value', async () => {
    const browser = new FakeBrowser();
    const result = await performToolAction(browser, {
      ...base,
      scope: { target, scopeValues: new Set(['E-000103']) },
      request: {
        action: 'search',
        destination: `${ORIGIN}/users`,
        parameters: [{ name: 'employee_id', value: 'E-000999' }],
      },
    });
    expect(browser.performed).toEqual([]);
    expect(result.action).toMatchObject({
      outcome: 'denied',
      denial: 'parameter-out-of-scope',
      offending: 'employee_id',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic).toBe('parameter-out-of-scope');
  });

  it('performs a parameterised action whose value the frozen population supplies', async () => {
    const browser = new FakeBrowser();
    const result = await performToolAction(browser, {
      ...base,
      scope: { target, scopeValues: new Set(['E-000103']) },
      request: {
        action: 'search',
        destination: `${ORIGIN}/users`,
        parameters: [{ name: 'employee_id', value: 'E-000103' }],
      },
    });
    expect(result.ok).toBe(true);
    expect(browser.performed).toHaveLength(1);
    // §B.1 derives an absence proof's query string from THIS log, so the value is kept.
    expect(result.action.parameters).toEqual([{ name: 'employee_id', value: 'E-000103' }]);
  });

  it('records what the workspace ENDED on, and how many downloads were offered', async () => {
    const browser = new FakeBrowser({
      result: { status: 200, location: `${ORIGIN}/users`, redirected: true, downloads: 2, session: true },
    });
    const result = await performToolAction(browser, {
      ...base,
      scope: { target, scopeValues: new Set() },
      request: { action: 'navigate', destination: ORIGIN, parameters: [] },
    });
    expect(result.action).toMatchObject({
      destination: `${ORIGIN}/users`,
      redirected: true,
      downloads: 2,
    });
  });

  it('records an action that presents no credential as PERMITTED capture', async () => {
    // The other half of the suppression. Without it, "capture is suppressed for a
    // credential-entry action" is satisfied by suppressing it for every action, which
    // would make Story 4.4 impossible and this column meaningless.
    const browser = new FakeBrowser();
    const result = await performToolAction(browser, {
      ...base,
      scope: { target, scopeValues: new Set() },
      request: { action: 'navigate', destination: ORIGIN, parameters: [] },
    });
    expect(result.action).toMatchObject({ capture: 'PERMITTED', captureSuppression: null });
    // And the port is asked for the arm that CAN carry a capture request.
    expect(browser.performed[0]).toMatchObject({ credential: null, capture: [] });
  });

  it('returns requested capture only after the action gate and credential scan', async () => {
    const artifact = { kind: 'structural-snapshot' as const, bytes: utf8Bytes('{}'), mediaType: 'application/json', location: ORIGIN };
    const browser = new FakeBrowser({ result: { artifacts: [artifact] } });
    const result = await performToolAction(browser, {
      ...base, requestedCapture: ['structural-snapshot'],
      scope: { target, scopeValues: new Set() },
      request: { action: 'navigate', destination: ORIGIN, parameters: [] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifacts).toEqual([artifact]);
    expect(browser.performed[0]).toMatchObject({ capture: ['structural-snapshot'], parameters: [] });
  });

  it.each(['secret', 'unrequested', 'credential-entry'] as const)('refuses %s artifacts before callers can store them', async failure => {
    const artifact = { kind: 'structural-snapshot' as const, bytes: utf8Bytes(TOKEN), mediaType: 'application/json', location: ORIGIN };
    const browser = new FakeBrowser({ result: { artifacts: [artifact] } });
    const result = await performToolAction(browser, {
      ...base,
      credential: failure === 'credential-entry' ? credential() : null,
      requestedCapture: failure === 'unrequested' ? [] : ['structural-snapshot'],
      guard: failure === 'secret' ? { held: 1, redact: x => x, discloses: () => true } : NO_CREDENTIALS,
      scope: { target, scopeValues: new Set() },
      request: { action: 'navigate', destination: ORIGIN, parameters: [] },
    });
    expect(result).toMatchObject({ ok: false, diagnostic: 'sign-in-contract-failed' });
    expect(result).not.toHaveProperty('artifacts');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('records a DENIED credential-entry action as suppressed too', async () => {
    // The gate refused it, so nothing left — but a credential was being presented, and a
    // row that said PERMITTED would describe an action the platform did not take.
    const browser = new FakeBrowser();
    const result = await performToolAction(browser, {
      ...base,
      credential: credential(),
      scope: { target, scopeValues: new Set() },
      request: { action: 'disable', destination: ORIGIN, parameters: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.action).toMatchObject({
      outcome: 'denied',
      capture: 'SUPPRESSED',
      captureSuppression: 'credential-entry',
    });
    expect(browser.performed).toEqual([]);
  });
});

describe('a database failure inside the phase', () => {
  it('writes RETRY rather than letting the throw reach the queue', async () => {
    // A throw out of this stage would fail the job, and a redelivery re-verifies the
    // population Evidence and spends one of that stage's four durable attempts. So a
    // database hiccup here must not cost a Run the budget of a stage that already finished.
    const state = store(planFor('web'));
    let thrown = false;
    const failing: AgentExecutionRepository = {
      transaction: async (_runId, work) => {
        const context = new FakeContext(state);
        if (!thrown) {
          context.saveToolAction = async () => {
            thrown = true;
            throw new Error('connection reset');
          };
        }
        return work(context);
      },
      recoverableRunIds: async () => [],
    };
    const deps = { ...DEPS(state, new FakeBrowser()), repository: failing };
    expect(await executeAgentSteps(deps, JOB)).toEqual({ retry: false, proceed: false });
    expect(thrown).toBe(true);
    expect(state.checkpoint).toMatchObject({ status: 'RETRY' });
    expect(state.run?.state).toBe('RUNNING');
  });
});
