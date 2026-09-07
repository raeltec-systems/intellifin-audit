import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initialDraftCompliance,
  registrationDigest,
  registrationDigestEnvelope,
  utf8Bytes,
  WEB_TREE_MEDIA_TYPE,
  type ExecutablePlan,
  type ProcedureTargetSnapshot,
  type RunRecord,
  type StoredSnapshot,
  type ToolActionParameter,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import type { AgentModelGateway, AgentModelRequest, AgentModelResponse } from './agent-ports.js';
import type {
  AdapterEvidenceRecord,
  BrowserActionResult,
  BrowserExecution,
  CredentialResolver,
  EvidenceStore,
  ExceptionFingerprinter,
  PopulationCheckpoint,
  PopulationRecord,
  StepExecutionRecord,
  WorkspaceRef,
} from './execution-ports.js';
import { executeAgentWorkItem, type AgentWorkDependencies } from './execute-agent-work-item.js';
import * as registration from './register-observations.js';
import * as gate from './run-gate.js';
import type { RunWait } from './waits.js';
import type { RegisteredObservation, ObservationEvaluationRow } from './execution-ports.js';
import type { AgentWorkCheckpoint, AgentTurnRecord, AgentWorkContext, AgentWorkRepository } from './agent-work-ports.js';

const RUN_ID = '01920000-0000-7000-8000-000000000101';
const CORRELATION_ID = '01920000-0000-7000-8000-000000000102';
const WORKSPACE_ID = 'workspace-1';
const TARGET_FIELDS = {
  kind: 'web' as const,
  allowedOrigins: ['https://loancore.example.test'],
  applicationIdentity: '',
  credentialRef: 'cred://loancore',
  permittedActions: ['navigate', 'search', 'read-attribute'] as const,
  attributeLabelPatterns: ['Employee ID', 'Full name', 'Status', 'Username', 'Roles'],
  secondaryKey: 'Full name',
};
const TARGET: ProcedureTargetSnapshot = {
  registrationId: 'loancore',
  displayName: 'LoanCore',
  digest: registrationDigest(TARGET_FIELDS),
  contract: registrationDigestEnvelope(TARGET_FIELDS),
};
const RECORD: PopulationRecord = {
  ordinal: 1,
  values: { employee_id: 'E-000105', full_name: 'Esther Kabwe' },
};
const PLAN = {
  schemaVersion: 1,
  compilerVersion: '1',
  inputs: {
    templateId: 'P-1',
    controlName: 'LoanCore account review',
    ...initialDraftCompliance('P-1'),
    targets: [TARGET],
    instructions: [{ registrationId: TARGET.registrationId, text: 'Inspect the approved account.' }],
  },
  sessionSteps: [
    { id: 'session-population', action: 'acquire-population', targetSystemId: null, text: 'Acquire population.' },
    { id: 'session-sign-in', action: 'sign-in', targetSystemId: TARGET.registrationId, text: 'Sign in.' },
  ],
  targetSystems: [{
    registrationId: TARGET.registrationId,
    planSteps: [
      { id: 'inspect-loancore', action: 'inspect-record', targetSystemId: TARGET.registrationId, text: 'Inspect records.' },
      { id: 'capture-loancore', action: 'capture-observation', targetSystemId: TARGET.registrationId, text: 'Capture.' },
      { id: 'evaluate-loancore', action: 'evaluate-conditions', targetSystemId: TARGET.registrationId, text: 'Evaluate.' },
    ],
  }],
  observations: [
    { attributeName: 'found', valueType: 'boolean' },
    { attributeName: 'account_status', valueType: 'text' },
    { attributeName: 'username', valueType: 'text' },
    { attributeName: 'roles', valueType: 'roles' },
    { attributeName: 'identity', valueType: 'text' },
  ],
  credentialReferences: [{ targetSystemId: TARGET.registrationId, credentialRef: TARGET.contract.credential_ref }],
  limits: {
    retriesPerStep: 3,
    stepTimeoutSeconds: 120,
    runStepExecutions: 100,
    runTimeoutSeconds: 3600,
    runTokens: 100000,
  },
} as unknown as ExecutablePlan;

const RUN: RunRecord = {
  runId: RUN_ID,
  correlationId: CORRELATION_ID,
  procedureId: '01920000-0000-7000-8000-000000000103',
  versionId: '01920000-0000-7000-8000-000000000104',
  versionNumber: 1,
  procedureName: 'Agent test',
  period: { from: '2026-09-01', to: '2026-09-30' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-07T00:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01920000-0000-7000-8000-000000000105',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null,
};

const SNAPSHOT_NODES = [
  { group: 'page', role: 'input', label: 'Employee ID', value: '', target: 'employee_id' },
  { group: 'page', role: 'input', label: 'Full name', value: '', target: 'full_name' },
] as const;

function snapshot(evidenceId: string, nodes: readonly unknown[] = SNAPSHOT_NODES): StoredSnapshot {
  return { evidenceId, substrate: 'web_tree', bytes: utf8Bytes(JSON.stringify({ schemaVersion: 1, nodes })) };
}

function identity(): AgentModelResponse['model'] {
  return {
    provider: 'anthropic', modelId: 'test-model', promptVersion: 'agent-prompt-v1', buildVersion: 'test',
    configuration: { responseFormat: 'agent-action-proposal-v1', maxOutputTokens: 100, maxActions: 1, temperature: 0 },
  };
}

function response(action: string | null, uncertainty: AgentModelResponse['uncertainty'] = { kind: 'none', rationale: null }): AgentModelResponse {
  return {
    schemaVersion: 1,
    route: 'anthropic',
    model: identity(),
    actions: action === null ? [] : [{
      toolId: action,
      // These fields are deliberately forged by the fake. The loop must use only toolId.
      action: 'navigate',
      destination: 'https://loancore.example.test/forged',
      locator: null,
      parameters: [],
    }],
    uncertainty,
    usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
  };
}

class FakeRepository implements AgentWorkRepository {
  run: RunRecord = { ...RUN };
  checkpoint: AgentWorkCheckpoint | null = null;
  workItems: AgentWorkContext['workItems'][number][] = [];
  evidence: AdapterEvidenceRecord[] = [];
  actions: AgentWorkContext['toolActions'][number][] = [];
  captures: AgentWorkContext['captures'][number][] = [];
  turns: AgentTurnRecord[] = [];
  executions: StepExecutionRecord[] = [];
  eventOrder: string[] = [];
  observations: RegisteredObservation[] = [];
  evaluations: ObservationEvaluationRow[] = [];
  waits: RunWait[] = [];
  waitRaises: NonNullable<AgentWorkContext['waitRaise']>[] = [];
  failObservationWrite = false;
  readonly records = [RECORD] as const;
  readonly population = {
    startedAt: '2026-09-07T00:00:00.000Z',
  } as unknown as PopulationCheckpoint;
  readonly workspace: WorkspaceRef = { runId: RUN_ID, workspaceId: WORKSPACE_ID, mode: 'local' };

  async transaction<T>(_runId: string, work: (context: AgentWorkContext) => Promise<T>): Promise<T> {
    const records = this.records;
    const executions = this.executions;
    const context = {
      run: this.run,
      population: this.population,
      checkpoint: this.checkpoint,
      workspace: this.workspace,
      prerequisitesReady: true,
      workItems: this.workItems,
      evidence: this.evidence,
      toolActions: this.actions,
      captures: this.captures,
      turns: this.turns,
      wait: this.waits.find(wait => wait.waitId === this.checkpoint?.waitId) ?? null,
      waitRaise: this.waitRaises.find(raised => raised.waitId === this.checkpoint?.waitId) ?? null,
      retainedDecisions: (this.checkpoint?.pendingWait?.retainedDecisionWaitIds ?? []).flatMap(id => {
        const wait = this.waits.find(row => row.waitId === id), raised = this.waitRaises.find(row => row.waitId === id);
        return wait && raised ? [{ wait, raised }] : [];
      }),
      readEvidenceStates: async (ids: readonly string[]) => this.evidence.filter(row => ids.includes(row.evidenceId)).map(row => ({ evidenceId: row.evidenceId, state: row.state })),
      readObservations: async (_item: string, keys: readonly string[]) => this.observations.filter(row => keys.includes(row.record.populationRecordKey)).map(row => ({ ...row, observationId: row.record.observationId, populationRecordKey: row.record.populationRecordKey })),
      saveObservations: async (rows: readonly RegisteredObservation[]) => {
        if (this.failObservationWrite) { this.failObservationWrite = false; throw new Error('simulated transaction failure before Observation insert'); }
        this.observations.push(...rows);
      },
      saveObservationChecks: async () => undefined,
      saveObservationEvaluations: async (rows: readonly ObservationEvaluationRow[]) => { this.evaluations.push(...rows); },
      saveExceptions: async () => undefined,
      async frozenPlan() { return PLAN; },
      async includedRecords() { return records; },
      async readStepExecutionCount() { return executions.length; },
      saveCheckpoint: async (checkpoint: AgentWorkCheckpoint, state: RunRecord['state']) => {
        this.checkpoint = { ...checkpoint };
        this.run = { ...this.run, state };
      },
      saveWorkItem: async (item: AgentWorkContext['workItems'][number]) => {
        const index = this.workItems.findIndex((current) => current.workItemId === item.workItemId);
        if (index < 0) this.workItems.push({ ...item });
        else this.workItems[index] = { ...item };
      },
      saveStepExecution: async (execution: StepExecutionRecord) => {
        const index = this.executions.findIndex((current) => current.stepExecutionId === execution.stepExecutionId);
        if (index < 0) this.executions.push({ ...execution });
        else this.executions[index] = { ...execution };
      },
      saveEvidence: async (evidence: AdapterEvidenceRecord) => {
        const index = this.evidence.findIndex((current) => current.evidenceId === evidence.evidenceId);
        if (index < 0) this.evidence.push({ ...evidence });
        else this.evidence[index] = { ...evidence };
      },
      saveToolAction: async (action: AgentWorkContext['toolActions'][number]) => {
        this.eventOrder.push('save-action');
        this.actions.push({ ...action });
      },
      saveCapture: async (binding: AgentWorkContext['captures'][number]) => {
        this.captures.push({ ...binding });
      },
      auditEvents: {
        append: async (event: { eventType: string }) => {
          this.eventOrder.push(`event:${event.eventType}`);
          return { sequence: this.eventOrder.length };
        },
      },
      notifyTimeline: async () => undefined,
      saveTurn: async (turn: AgentTurnRecord) => {
        const index = this.turns.findIndex((current) => current.sequence === turn.sequence);
        if (index < 0) this.turns.push({ ...turn });
        else this.turns[index] = { ...turn };
      },
    } as unknown as AgentWorkContext;
    // The real repository creates a fresh transaction context. Keep the same object
    // references here so every fake save still models a durable commit boundary.
    return work(context);
  }

  async recoverableRunIds(): Promise<string[]> { return []; }
}

function deps(
  repository: FakeRepository,
  browser: BrowserExecution,
  model: AgentModelGateway,
  waits: AgentWorkDependencies['waits'],
): AgentWorkDependencies {
  const clock: Clock = { now: () => new Date('2026-09-07T00:00:01.000Z') };
  const ids: UuidV7Generator = {
    next: (() => {
      let count = 200;
      return () => `01920000-0000-7000-8000-${String(count++).padStart(12, '0')}`;
    })(),
  };
  const store: EvidenceStore = {
    async putIfAbsent(key, bytes) {
      if (!objects.has(key)) objects.set(key, bytes.slice());
    },
    async read(key) { return objects.get(key)?.slice() ?? null; },
  };
  const objects = new Map<string, Uint8Array>();
  const credentials: CredentialResolver = {
    resolve: vi.fn(async (reference: string) => ({
      reference,
      authorize: () => undefined,
      enter: () => undefined,
      redact: (text: string) => text,
      discloses: () => false,
    })),
  };
  const exceptions: ExceptionFingerprinter = { keyId: 'test-key', fingerprint: () => 'fingerprint' };
  return { repository, browser, model, credentials, store, clock, ids, exceptions, waits };
}

function browserFor(repository: FakeRepository, nodes: readonly unknown[] = SNAPSHOT_NODES): BrowserExecution {
  let count = 0;
  return {
    mode: 'local',
    async create() { throw new Error('not used'); },
    async attach() { return null; },
    async release() { return undefined; },
    async perform(_ref, action): Promise<BrowserActionResult> {
      repository.eventOrder.push(`browser:${action.action}`);
      count += 1;
      const id = count === 1 ? 'snapshot-bootstrap' : 'snapshot-search';
      return {
        status: 200,
        method: 'GET',
        location: action.destination,
        redirected: false,
        downloads: 0,
        session: true,
        artifacts: [{ kind: 'structural-snapshot', bytes: snapshot(id, nodes).bytes, mediaType: WEB_TREE_MEDIA_TYPE, location: action.destination }],
      };
    },
  };
}

describe('executeAgentWorkItem', () => {
  afterEach(() => vi.restoreAllMocks());
  it('captures the bootstrap page first and resolves the proposed tool to frozen search parameters', async () => {
    const repository = new FakeRepository();
    const browser = browserFor(repository);
    const gateway: AgentModelGateway = {
      identity: identity(),
      propose: vi.fn(async (request: AgentModelRequest) => {
        const search = request.tools.find((tool) => tool.action === 'search');
        return gatewayCalls++ === 0
          ? response(search?.toolId ?? null)
          : response(null);
      }),
    };
    let gatewayCalls = 0;
    const waits = { raiseEscalation: vi.fn(async () => ({ ok: false as const, reason: 'test' })) };
    const dependencies = deps(repository, browser, gateway, waits);
    const result = await executeAgentWorkItem(dependencies, {
      schemaVersion: 1, runId: RUN_ID, correlationId: CORRELATION_ID,
    });
    expect(result.retry).toBe(true);
    expect(dependencies.credentials.resolve).toHaveBeenCalledWith('cred://loancore', expect.any(Number));
    expect(gateway.propose).toHaveBeenCalled();
    expect(repository.actions.map((action) => action.action)).toEqual(['navigate', 'search']);
    const search = repository.actions[1]!;
    expect(search.parameters).toEqual([{ name: 'employee_id', value: RECORD.values.employee_id }]);
    expect(search.destination).toBe('https://loancore.example.test/');
    expect(repository.eventOrder.indexOf('save-action')).toBeGreaterThan(repository.eventOrder.indexOf('browser:navigate'));
    expect(repository.workItems[0]?.state).toBe('IN_PROGRESS');
  });

  it('persists a pending typed wait before calling the wait port and resumes without a note', async () => {
    const repository = new FakeRepository();
    const browser = browserFor(repository);
    const gateway: AgentModelGateway = {
      identity: identity(),
      propose: vi.fn(async () => response(null, { kind: 'insufficient-evidence', rationale: 'page unclear' })),
    };
    const waits = { raiseEscalation: vi.fn(async () => {
      expect(repository.checkpoint?.status).toBe('WAITING');
      expect(repository.checkpoint?.pendingWait?.kind).toBe('retry-or-skip');
      return { ok: false as const, reason: 'test' };
    }) };
    const result = await executeAgentWorkItem(deps(repository, browser, gateway, waits), {
      schemaVersion: 1, runId: RUN_ID, correlationId: CORRELATION_ID,
    });
    expect(result.retry).toBe(true);
    expect(waits.raiseEscalation).toHaveBeenCalledTimes(1);
    expect(repository.checkpoint?.status).toBe('WAITING');
    expect(repository.checkpoint?.pendingWait?.options.map((option) => option.id)).toEqual(['retry', 'skip', 'abort']);
  });

  it('re-establishes browser navigation on a fresh attempt instead of treating stored Evidence as the current page', async () => {
    const repository = new FakeRepository(), browser = browserFor(repository);
    const gateway: AgentModelGateway = { identity: identity(), propose: vi.fn(async () => response(null)) };
    const dependencies = deps(repository, browser, gateway, { raiseEscalation: vi.fn(async () => ({ ok: false as const, reason: 'unused' })) });
    await executeAgentWorkItem(dependencies, JOB);
    expect(repository.checkpoint?.status).toBe('RETRY');
    expect(repository.evidence.length).toBeGreaterThan(0);
    await executeAgentWorkItem(dependencies, JOB);
    expect(repository.actions.map(action => action.action)).toEqual(['navigate','navigate']);
  });
  it('recovers an unraised wait intent without repeating the browser or model action', async () => {
    const repository = new FakeRepository(), browser = browserFor(repository);
    const gateway: AgentModelGateway = { identity: identity(), propose: vi.fn(async () => response(null, { kind: 'insufficient-evidence', rationale: 'Unclear' })) };
    const waits = { raiseEscalation: vi.fn(async () => ({ ok: false as const, reason: 'temporary failure' })) };
    const dependencies = deps(repository, browser, gateway, waits);
    await executeAgentWorkItem(dependencies, JOB);
    expect(repository.checkpoint).toMatchObject({ status: 'WAITING', waitId: null });
    const actions = repository.actions.length;
    await executeAgentWorkItem(dependencies, JOB);
    expect(waits.raiseEscalation).toHaveBeenCalledTimes(2);
    expect(repository.actions).toHaveLength(actions); expect(gateway.propose).toHaveBeenCalledTimes(1);
    expect(waits.raiseEscalation).toHaveBeenLastCalledWith(expect.objectContaining({ supportingEvidenceIds: [repository.workItems[0]!.evidenceId] }));
  });
  it('raises a choose-candidate wait for duplicate grounded identities before model I/O', async () => {
    const duplicateNodes = [
      { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null },
      { group: 'record:0', role: 'datum', label: 'Full name', value: 'Esther Kabwe', target: null },
      { group: 'record:1', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null },
    ] as const;
    const repository = new FakeRepository();
    const gateway: AgentModelGateway = {
      identity: identity(),
      propose: vi.fn(async () => response(null)),
    };
    const waits = {
      raiseEscalation: vi.fn(async (input: Parameters<AgentWorkDependencies['waits']['raiseEscalation']>[0]) => {
        expect(input.kind).toBe('choose-candidate');
        expect(input.options?.map((option) => typeof option === 'string' ? option : option.id)).toEqual([
          'candidate-0', 'candidate-2', 'mark-ambiguous',
        ]);
        expect(repository.checkpoint?.status).toBe('WAITING');
        return { ok: false as const, reason: 'test' };
      }),
    };
    const result = await executeAgentWorkItem(deps(repository, browserFor(repository, duplicateNodes), gateway, waits), {
      schemaVersion: 1, runId: RUN_ID, correlationId: CORRELATION_ID,
    });
    expect(result.retry).toBe(true);
    expect(gateway.propose).not.toHaveBeenCalled();
    expect(repository.workItems[0]?.state).toBe('AWAITING');
    expect(repository.checkpoint?.pendingWait?.kind).toBe('choose-candidate');
  });
});

const FOUND_CANDIDATES = ['active','disabled'].flatMap((status, index) => [
  { group: `record:${index}`, role: 'datum', label: 'Employee ID', value: RECORD.values.employee_id, target: null },
  { group: `record:${index}`, role: 'datum', label: 'Full name', value: RECORD.values.full_name, target: null },
  { group: `record:${index}`, role: 'datum', label: 'Status', value: status, target: null },
  { group: `record:${index}`, role: 'datum', label: 'Username', value: `synthetic-${index}`, target: null },
  { group: `record:${index}`, role: 'datum', label: 'Roles', value: ['read-only'], target: null },
]);
const JOB = { schemaVersion: 1 as const, runId: RUN_ID, correlationId: CORRELATION_ID };
function durableWaitPort(repository: FakeRepository): AgentWorkDependencies['waits'] {
  return { raiseEscalation: vi.fn(async (input: Parameters<AgentWorkDependencies['waits']['raiseEscalation']>[0]): Promise<Awaited<ReturnType<AgentWorkDependencies['waits']['raiseEscalation']>>> => {
    const waitId = `01920000-0000-7000-8000-${String(900 + repository.waits.length).padStart(12, '0')}`;
    const wait: RunWait = { runId: input.runId, waitId, kind: input.kind,
      options: (input.options ?? []).map(option => typeof option === 'string' ? { id: option, label: option } : option),
      deadline: '2026-09-07T04:00:01.000Z', closedAt: null, closureKind: null, answerOptionId: null, actor: null };
    repository.waits.push(wait); repository.waitRaises.push({ runId: input.runId, waitId, stepId: input.stepId!, supportingEvidenceIds: input.supportingEvidenceIds ?? [] });
    repository.run = { ...repository.run, state: 'AWAITING_AUDITOR' };
    return { ok: true, wait, run: { ...repository.run, revision: 1 } };
  }) };
}
function answerLast(repository: FakeRepository, answerOptionId: string): void {
  const wait = repository.waits.at(-1)!;
  repository.waits[repository.waits.length - 1] = { ...wait, answerOptionId, actor: 'auditor', closureKind: 'answer', closedAt: '2026-09-07T00:00:01.000Z' };
  repository.run = { ...repository.run, state: 'RUNNING' };
}
function evaluationModel(): AgentModelGateway {
  return { identity: identity(), propose: vi.fn(async (request: AgentModelRequest): Promise<AgentModelResponse> => {
    if (request.phase === 'evaluation' && request.evaluation) return {
      schemaVersion: 1, phase: 'evaluation', route: 'anthropic', model: identity(), actions: [],
      agentProposals: request.evaluation.conditions.map(condition => ({ observationId: request.evaluation!.observationId, conditionId: condition.conditionId, value: 'COMPLIANT', confidence: '0.99', rationale: 'Synthetic test judgment.' })),
      uncertainty: { kind: 'none', rationale: null }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
    return response(request.tools.find(tool => tool.action === 'read-attribute')?.toolId ?? null);
  }) };
}

describe('agent work consumes durable human decisions with original capture', () => {
  afterEach(() => vi.restoreAllMocks());
  // The Gate has its own repository integration. These unit cases use the REAL shared
  // Observation registration/corroboration/evaluation and focus on decision consumption.
  function gateBoundary() { vi.spyOn(gate, 'runRunLevelGate').mockResolvedValue(undefined as never); }
  it('resumes a selected duplicate candidate without reading a changed browser page', async () => {
    gateBoundary();
    const repository = new FakeRepository(), browser = browserFor(repository, FOUND_CANDIDATES), model = evaluationModel();
    const perform = vi.spyOn(browser, 'perform');
    const dependencies = deps(repository, browser, model, durableWaitPort(repository));
    await executeAgentWorkItem(dependencies, JOB);
    expect(repository.waits[0]?.kind).toBe('choose-candidate');
    const originalEvidence = repository.waitRaises[0]!.supportingEvidenceIds[0]!;
    answerLast(repository, 'candidate-5');
    perform.mockClear();
    expect(await executeAgentWorkItem(dependencies, JOB)).toEqual({ retry: false });
    expect(perform).not.toHaveBeenCalled();
    expect(repository.observations).toHaveLength(1);
    expect(repository.observations[0]!.record).toMatchObject({ found: 'true', matchOrigin: 'human-matched', evidenceIds: [originalEvidence], attributes: expect.arrayContaining([expect.objectContaining({ name: 'account_status', normalizedValue: 'disabled' })]) });
    expect(repository.checkpoint).toMatchObject({ waitId: null, pendingWait: null, status: 'COMPLETE' });
  });
  it('keeps the closed choice when registration fails, then a fresh context consumes it exactly once', async () => {
    gateBoundary();
    const repository = new FakeRepository(), browser = browserFor(repository, FOUND_CANDIDATES);
    const dependencies = deps(repository, browser, evaluationModel(), durableWaitPort(repository));
    await executeAgentWorkItem(dependencies, JOB); answerLast(repository, 'candidate-5');
    const waitId = repository.checkpoint!.waitId;
    repository.failObservationWrite = true;
    expect(await executeAgentWorkItem(dependencies, JOB)).toEqual({ retry: true });
    expect(repository.observations).toHaveLength(0); expect(repository.checkpoint).toMatchObject({ waitId, status: 'RETRY' });
    // The next call reconstructs its whole transaction context from persisted rows.
    expect(await executeAgentWorkItem(dependencies, JOB)).toEqual({ retry: false });
    expect(repository.observations).toHaveLength(1);
    expect(repository.observations[0]!.record.matchOrigin).toBe('human-matched');
    await executeAgentWorkItem(dependencies, JOB); expect(repository.observations).toHaveLength(1);
  });
  it('retains candidate selection through an unnamed-value wait and evaluates the original status unchanged', async () => {
    gateBoundary();
    const records = FOUND_CANDIDATES.map((node, index) => index === 7 ? { ...node, value: 'Suspended' } : node);
    const repository = new FakeRepository(), browser = browserFor(repository, records);
    const dependencies = deps(repository, browser, evaluationModel(), durableWaitPort(repository));
    await executeAgentWorkItem(dependencies, JOB); answerLast(repository, 'candidate-5');
    const candidateWaitId = repository.checkpoint!.waitId!;
    await executeAgentWorkItem(dependencies, JOB);
    expect(repository.waits.at(-1)?.kind).toBe('unnamed-value');
    expect(repository.observations).toHaveLength(0);
    expect(repository.checkpoint?.pendingWait?.retainedDecisionWaitIds).toEqual([candidateWaitId]);
    answerLast(repository, 'mark-unevaluated');
    expect(await executeAgentWorkItem(dependencies, JOB)).toEqual({ retry: false });
    expect(repository.observations[0]!.record).toMatchObject({ matchOrigin: 'human-matched', attributes: expect.arrayContaining([expect.objectContaining({ name: 'account_status', normalizedValue: 'Suspended' })]) });
    expect(repository.evaluations).toContainEqual(expect.objectContaining({ evaluation: expect.objectContaining({ conditionId: 'C1', origin: 'RULE', value: 'UNEVALUATED', diagnostic: 'rule does not name value Suspended' }) }));
    expect(repository.waits).toHaveLength(2);
  });
  it('retains both candidate choice and unnamed acknowledgement through a subsequent model retry wait', async () => {
    gateBoundary();
    const rows = FOUND_CANDIDATES.map((node, index) => index === 7 ? { ...node, value: 'Suspended' } : node);
    const repository = new FakeRepository(), browser = browserFor(repository, rows), model = evaluationModel();
    const originalPropose = model.propose;
    let calls = 0;
    const retryingModel: AgentModelGateway = { ...model, propose: async request => {
      if (request.phase === 'evaluation' && calls++ === 0) return { ...response(null, { kind: 'insufficient-evidence', rationale: 'Synthetic transient uncertainty' }), phase: 'evaluation', agentProposals: [] };
      return originalPropose(request);
    } };
    const dependencies = deps(repository, browser, retryingModel, durableWaitPort(repository));
    await executeAgentWorkItem(dependencies, JOB); answerLast(repository, 'candidate-5');
    const candidateId = repository.waits[0]!.waitId;
    await executeAgentWorkItem(dependencies, JOB); answerLast(repository, 'mark-unevaluated');
    const unnamedId = repository.waits[1]!.waitId;
    await executeAgentWorkItem(dependencies, JOB);
    expect(repository.waits.at(-1)?.kind).toBe('retry-or-skip');
    expect(repository.checkpoint?.pendingWait?.retainedDecisionWaitIds).toEqual([candidateId, unnamedId]);
    answerLast(repository, 'retry');
    expect(await executeAgentWorkItem(dependencies, JOB)).toEqual({ retry: false });
    expect(repository.observations).toHaveLength(1);
    expect(repository.observations[0]!.record.matchOrigin).toBe('human-matched');
    expect(repository.evaluations).toContainEqual(expect.objectContaining({ evaluation: expect.objectContaining({ conditionId: 'C1', value: 'UNEVALUATED' }) }));
    expect(repository.waits).toHaveLength(3);
  });
  it('preserves a choice while a model call is in flight and an expired lease is recovered', async () => {
    gateBoundary();
    const repository = new FakeRepository(), browser = browserFor(repository, FOUND_CANDIDATES), baseModel = evaluationModel();
    let release!: (response: AgentModelResponse) => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<AgentModelResponse>(resolve => { release = resolve; });
    let first = true, firstRequest: AgentModelRequest | null = null;
    const model: AgentModelGateway = { ...baseModel, propose: async request => {
      if (request.phase === 'evaluation' && first) { first = false; firstRequest = request; entered(); return held; }
      return baseModel.propose(request);
    } };
    const dependencies = deps(repository, browser, model, durableWaitPort(repository));
    await executeAgentWorkItem(dependencies, JOB); answerLast(repository, 'candidate-5');
    const originalWait = repository.checkpoint!.waitId;
    const blocked = executeAgentWorkItem(dependencies, JOB);
    await waiting;
    expect(repository.checkpoint).toMatchObject({ status: 'EXECUTING', waitId: originalWait });
    const recovered = await executeAgentWorkItem({ ...dependencies, clock: { now: () => new Date('2026-09-07T00:02:02.000Z') } }, JOB);
    expect(recovered).toEqual({ retry: false });
    release(await baseModel.propose(firstRequest!)); await blocked;
    expect(repository.observations).toHaveLength(1);
    expect(repository.checkpoint).toMatchObject({ status: 'COMPLETE', waitId: null });
  });
  it('mark ambiguous produces no fabricated absence or compliant evaluation', async () => {
    gateBoundary();
    const original = registration.registerObservations, failures: unknown[] = [];
    vi.spyOn(registration, 'registerObservations').mockImplementation(async (...args) => { try { return await original(...args); } catch (error) { failures.push(error); throw error; } });
    const repository = new FakeRepository(), browser = browserFor(repository, FOUND_CANDIDATES);
    const dependencies = deps(repository, browser, evaluationModel(), durableWaitPort(repository));
    await executeAgentWorkItem(dependencies, JOB); answerLast(repository, 'mark-ambiguous');
    const result = await executeAgentWorkItem(dependencies, JOB); expect(failures).toEqual([]);
    expect(result).toEqual({ retry: false });
    expect(repository.observations[0]).toMatchObject({ coverage: 'AMBIGUOUS', record: { found: 'ambiguous', identity: null } });
    expect(repository.evaluations.some(row => row.evaluation.value === 'COMPLIANT')).toBe(false);
  });
});
