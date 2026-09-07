import {
  observationChecks, observationCoverage, observationCorroborationState, RULE_DOES_NOT_NAME_VALUE,
  adapterLookupColumn,
  adapterSearchKeys,
  classifyPlanTargets,
  decodePopulationUtf8,
  exhaustedRunLimit,
  findProcedureTemplate,
  parseFrozenLocation,
  readStructuralSnapshot,
  runStopFor,
  withinFrozenOrigin,
  type ClassifiedTarget,
  type ExecutablePlan,
  type PermittedReadAction,
  type ProcedureTargetSnapshot,
  type RunLimitCause,
  type RunRecord,
  type SanitizedToolAction,
  type StoredSnapshot,
  type ToolActionParameter,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import {
  BrowserActionError,
  PopulationAcquisitionError,
  type AdapterEvidenceRecord,
  type BrowserExecution,
  type CredentialResolver,
  type EvidenceStore,
  type ExceptionFingerprinter,
  type PopulationRecord,
  type StepExecutionRecord,
  type WorkItemRecord,
  type WorkspaceRef,
} from './execution-ports.js';
import type { PopulationJob } from './acquire-population.js';
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
} from './agent-ports.js';
import type { AgentWorkCheckpoint, AgentWorkContext, AgentWorkRepository } from './agent-work-ports.js';
import { executeAgentModelTurn } from './execute-agent-model-turn.js';
import { applyAgentHumanDecision } from './agent-human-decision.js';
import { freezeAgentCapture } from './agent-capture.js';
import { buildAbsentAgentObservation, buildFoundAgentObservation, type AgentFieldSelection } from './agent-observation.js';
import { planAgentTools, type AgentSearchEvidence, type AgentToolPlannerResult } from './agent-tool-planner.js';
import { guardedCredentials, type CredentialGuard } from './credential-guard.js';
import { performToolAction } from './execute-agent-steps.js';
import { readRegisteredArtifact } from './evidence-package.js';
import { registerObservations } from './register-observations.js';
import { ruleEvaluation } from './rule-evaluation.js';
import { agentRuleEvaluation, applicableAgentConditionIds } from './agent-rule-evaluation.js';
import type { AgentJudgedProposal } from './agent-evaluation.js';
import { snapshotCorroboration } from './snapshot-corroboration.js';
import {
  ESCALATION_OPTION_IDS,
  FIXED_ESCALATION_OPTIONS,
  type EscalationKind,
  type EscalationOption,
  type RaiseEscalationInput,
  type RaiseEscalationResult,
  type RunWait,
} from './waits.js';
import { runRunLevelGate, SECURITY_DENIED_EVENT } from './run-gate.js';
import { completeRun } from './complete-run.js';
import { performCancellation } from './cancel-run.js';

/** The bounded worker input. It is deliberately the same shape as the population job. */
export type AgentWorkItemJob = PopulationJob;

/** A wait callback bound by the worker composition root to the durable wait repository. */
export interface AgentWorkWaits {
  raiseEscalation(input: RaiseEscalationInput): Promise<RaiseEscalationResult>;
}

/** Dependencies for the P-1 web work-item stage. */
export interface AgentWorkDependencies {
  readonly repository: AgentWorkRepository;
  readonly browser: BrowserExecution;
  /** The worker's resolver, retained in the dependency shape for credential containment. */
  readonly credentials: CredentialResolver;
  /** `null` means this deployment has no configured provider. It is a run failure. */
  readonly model: AgentModelGateway | null;
  readonly store: EvidenceStore;
  readonly clock: Clock;
  readonly ids: UuidV7Generator;
  readonly exceptions: ExceptionFingerprinter;
  /** The callback is bound to `raiseEscalation` in the worker composition root. */
  readonly waits: AgentWorkWaits;
  /** Retained for composition compatibility; this stage rehydrates its own guarded resolver. */
  readonly credentialGuard?: CredentialGuard;
}

/** Closed diagnostics emitted by this stage. Work-item diagnostics remain strings in the port. */
export type AgentWorkDiagnostic =
  | 'unsupported-frozen-plan'
  | 'prerequisites-incomplete'
  | 'workspace-missing'
  | 'model-not-configured'
  | 'model-invalid-action'
  | 'model-no-proposal'
  | 'model-unavailable'
  | 'model-timeout'
  | 'model-canceled'
  | 'model-configuration'
  | 'model-invalid-request'
  | 'model-invalid-response'
  | 'model-provider-refused'
  | 'browser-unavailable'
  | 'browser-denied'
  | 'browser-scope-violation'
  | 'browser-contract-failed'
  | 'capture-integrity-failed'
  | 'capture-contract-failed'
  | 'credential-unresolved'
  | 'observation-registration-refused'
  | 'human-decision-refused'
  | 'unnamed-value'
  | 'ambiguous-match'
  | 'insufficient-evidence'
  | 'run-time-limit'
  | 'run-step-execution-limit'
  | 'run-token-limit'
  | 'attempt-limit'
  | 'canceled'
  | 'lost-claim';

export interface AgentWorkItemOutcome {
  /** A lost claim or a retryable checkpoint asks the queue to redeliver the Run. */
  readonly retry: boolean;
}

const AGENT_EVENT = 'lifecycle.agent-work';
const INSPECT_ACTION = 'inspect-record' as const;
const TEMPLATE_ID = 'P-1' as const;
const STRUCTURAL_MEDIA_TYPE = /^application\/vnd\.intellifin\.web-tree\+json(?:\s*;\s*charset=utf-8)?$/iu;
const MAX_ACTIONS_PER_TURN = 16;

interface AgentClaim {
  readonly checkpoint: AgentWorkCheckpoint;
  readonly plan: ExecutablePlan;
  readonly run: RunRecord;
  readonly workspace: WorkspaceRef;
  readonly targets: readonly ClassifiedTarget[];
  readonly records: readonly PopulationRecord[];
  readonly items: readonly WorkItemRecord[];
  readonly evidence: readonly AdapterEvidenceRecord[];
  readonly toolActions: readonly SanitizedToolAction[];
  readonly captures: readonly { evidenceId: string; toolActionId: string; sourceLocation: string }[];
  readonly stepExecutions: number;
  readonly decision: { readonly wait: RunWait; readonly checkpoint: AgentWorkCheckpoint; readonly raised: NonNullable<AgentWorkContext['waitRaise']>; readonly retained: AgentWorkContext['retainedDecisions'] } | null;
}

interface SnapshotState {
  readonly snapshot: StoredSnapshot;
  readonly sourceLocation: string;
  readonly screenshotEvidenceId: string | null;
}

/** A resolver failure has a fixed diagnostic; provider error text never reaches the Run. */
class AgentCredentialError extends Error {
  constructor() {
    super('credential-unresolved');
    this.name = 'AgentCredentialError';
  }
}

function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}

function safeOrigin(target: ProcedureTargetSnapshot): string | null {
  const raw = target.contract.allowed_origins[0];
  const parsed = parseFrozenLocation(raw);
  return parsed === null ? null : `${parsed.authority}${parsed.path}`;
}

function targetStepText(plan: ExecutablePlan, target: ProcedureTargetSnapshot): string {
  const targetPlan = plan.targetSystems.find((entry) => entry.registrationId === target.registrationId);
  const inspect = targetPlan?.planSteps.find((step) => step.action === INSPECT_ACTION);
  const instruction = plan.inputs.instructions?.find((entry) => entry.registrationId === target.registrationId);
  return instruction?.text ?? inspect?.text ?? `Inspect records in ${target.displayName}.`;
}

function stringScope(record: PopulationRecord): ReadonlySet<string> {
  const values = new Set<string>();
  for (const value of Object.values(record.values)) if (typeof value === 'string') values.add(value);
  return values;
}

function completeZero(snapshot: StoredSnapshot): boolean {
  if (snapshot.substrate !== 'web_tree') return false;
  const parsed = readStructuralSnapshot(snapshot);
  return parsed.ok && parsed.substrate === 'web_tree' &&
    parsed.document.completion?.complete === true && parsed.document.completion.returned === 0;
}

function decodeSnapshot(snapshot: StoredSnapshot): string {
  try {
    return decodePopulationUtf8(snapshot.bytes);
  } catch {
    return '';
  }
}

function artifactSubstrate(artifact: AdapterEvidenceRecord): 'web_tree' | null {
  return artifact.kind === 'structural-snapshot' && artifact.mediaType !== null && STRUCTURAL_MEDIA_TYPE.test(artifact.mediaType)
    ? 'web_tree'
    : null;
}

async function readSnapshotForBinding(
  store: EvidenceStore,
  binding: { evidenceId: string; sourceLocation: string },
  evidence: readonly AdapterEvidenceRecord[],
  budget: () => number,
): Promise<StoredSnapshot | null> {
  const row = evidence.find((entry) => entry.evidenceId === binding.evidenceId);
  if (row === undefined || row.state !== 'REGISTERED' || artifactSubstrate(row) === null || row.digest === null || row.size === null) {
    return null;
  }
  const bytes = await readRegisteredArtifact(store, row, budget);
  return bytes === null ? null : { evidenceId: row.evidenceId, substrate: 'web_tree', bytes };
}

function searchLookupKey(
  target: ProcedureTargetSnapshot,
  population: PopulationRecord,
  parameters: readonly ToolActionParameter[],
  controlSnapshot: StoredSnapshot,
): string | null {
  if (controlSnapshot.substrate !== 'web_tree') return null;
  const parsed = readStructuralSnapshot(controlSnapshot);
  if (!parsed.ok || parsed.substrate !== 'web_tree') return null;
  const primary = adapterLookupColumn(TEMPLATE_ID);
  const keys = adapterSearchKeys(TEMPLATE_ID);
  const labels = findProcedureTemplate(TEMPLATE_ID).declaredAttributeLabels;
  if (primary === null || keys === null || labels === null) return null;
  const secondary = keys.find((key) => key !== primary);
  if (secondary === undefined) return null;
  const byName = new Map<string, string>();
  for (const parameter of parameters) {
    const controls: readonly (typeof parsed.document.nodes[number])[] = parsed.document.nodes.filter((node) =>
      node.role === 'input' && node.target === parameter.name &&
      // A pre-search capture normally holds an empty form value. If the page exposed a
      // prefilled value, it must already equal the platform's exact parameter; a different
      // value cannot be attributed to this search merely because its label looks right.
      (node.value === '' || node.value === parameter.value) &&
      (node.label === labels.identity || node.label === target.contract.secondary_key));
    if (controls.length !== 1) return null;
    const node: (typeof parsed.document.nodes[number]) = controls[0]!;
    const key = node.label === labels.identity ? primary :
      node.label === target.contract.secondary_key ? secondary : null;
    if (key === null || byName.has(key) || population.values[key] !== parameter.value) return null;
    byName.set(key, parameter.value);
  }
  return byName.size === 1 ? [...byName.keys()][0]! : null;
}

function currentSearchQueryKeys(
  searches: readonly AgentSearchEvidence[],
  target: ProcedureTargetSnapshot,
  population: PopulationRecord,
): readonly { key: string; value: string }[] {
  const keys = adapterSearchKeys(TEMPLATE_ID) ?? [];
  const out = new Map<string, string>();
  for (const search of searches) {
    const key = search.lookupKey ?? searchLookupKey(target, population, search.parameters, search.controlSnapshot ?? search.snapshot);
    if (key === null || out.has(key)) continue;
    const value = population.values[key];
    if (typeof value === 'string' && value.length > 0) out.set(key, value);
  }
  return keys.flatMap((key) => {
    const value = out.get(key);
    return value === undefined ? [] : [{ key, value }];
  });
}

function targetTool(
  planned: AgentToolPlannerResult,
  toolId: string,
): { readonly action: PermittedReadAction; readonly destination: string; readonly parameters: readonly ToolActionParameter[]; readonly locator: { substrate: 'web_tree'; path: string } | null } | null {
  const tool = planned.tools.find((candidate) => candidate.toolId === toolId);
  if (tool === undefined) return null;
  return {
    action: tool.action,
    destination: tool.destination,
    parameters: planned.parametersByToolId[tool.toolId] ?? [],
    locator: tool.locator,
  };
}

function modelDiagnostic(value: string): AgentWorkDiagnostic {
  const code = value.replace(/^model-/u, '');
  switch (code) {
    case 'configuration': return 'model-configuration';
    case 'invalid-request': return 'model-invalid-request';
    case 'invalid-response': return 'model-invalid-response';
    case 'timeout': return 'model-timeout';
    case 'canceled': return 'model-canceled';
    case 'provider-refused': return 'model-provider-refused';
    default: return 'model-unavailable';
  }
}

function actionDiagnostic(value: string): AgentWorkDiagnostic {
  switch (value) {
    case 'action-not-permitted': return 'browser-denied';
    case 'destination-refused':
    case 'origin-not-allowed': return 'browser-scope-violation';
    case 'parameter-out-of-scope': return 'browser-denied';
    case 'sign-in-denied': return 'browser-denied';
    case 'sign-in-scope-violation': return 'browser-scope-violation';
    case 'sign-in-contract-failed': return 'browser-contract-failed';
    case 'sign-in-unavailable': return 'browser-unavailable';
    default: return 'browser-unavailable';
  }
}

function failureDiagnostic(error: unknown): AgentWorkDiagnostic {
  if (error instanceof AgentCredentialError) return 'credential-unresolved';
  if (error instanceof PopulationAcquisitionError) {
    if (error.code === 'integrity') return 'capture-integrity-failed';
    return 'capture-contract-failed';
  }
  if (error instanceof BrowserActionError) return 'browser-unavailable';
  if (error instanceof Error && error.name === 'ObservationRegistrationError') return 'observation-registration-refused';
  return 'capture-contract-failed';
}

function terminalSecurityCause(diagnostic: string): 'action-denied' | 'scope-violation' | null {
  const normalized = actionDiagnostic(diagnostic);
  return normalized === 'browser-scope-violation' ? 'scope-violation' :
    normalized === 'browser-denied' ? 'action-denied' : null;
}

function isTerminalWorkItem(item: WorkItemRecord): boolean {
  return item.state === 'OBSERVED' || item.state === 'UNINSPECTED' || item.state === 'AMBIGUOUS' || item.state === 'FAILED';
}

function checkpointLease(
  checkpoint: AgentWorkCheckpoint,
  clock: Clock,
  plan: ExecutablePlan,
): AgentWorkCheckpoint {
  const now = clock.now().getTime();
  const deadline = Date.parse(checkpoint.runStartedAt) + plan.limits.runTimeoutSeconds * 1000;
  const lease = Math.min(deadline, now + plan.limits.stepTimeoutSeconds * 1000);
  return { ...checkpoint, leaseUntil: new Date(lease).toISOString() };
}

function optionForKind(kind: EscalationKind, candidates: AgentToolPlannerResult['candidates']): readonly EscalationOption[] {
  if (kind !== 'choose-candidate') return FIXED_ESCALATION_OPTIONS[kind];
  return [
    ...candidates.map((candidate) => ({ id: candidate.id, label: candidate.label })),
    { id: ESCALATION_OPTION_IDS.markAmbiguous, label: 'Mark the record ambiguous' },
  ];
}

async function appendEvent(
  context: AgentWorkContext,
  run: RunRecord,
  diagnostic: string,
  state: RunRecord['state'],
  checkpoint: AgentWorkCheckpoint,
  fields: Record<string, unknown> = {},
  outcome: 'success' | 'failure' = 'success',
): Promise<void> {
  const stored = await context.auditEvents.append({
    actor: { type: 'system', id: 'agent-worker' },
    eventType: AGENT_EVENT,
    source: 'worker',
    outcome,
    aggregateId: run.runId,
    correlationId: run.correlationId,
    sessionId: run.sessionId,
    payload: {
      state,
      diagnostic,
      attemptId: checkpoint.attemptId,
      workItemId: checkpoint.workItemId,
      nextTurn: checkpoint.nextTurn,
      tokens: checkpoint.tokens,
      reservedTokens: checkpoint.reservedTokens,
      ...fields,
    },
  });
  await context.notifyTimeline(stored.sequence);
}

function runLimit(
  stepExecutions: number,
  checkpoint: AgentWorkCheckpoint,
  plan: ExecutablePlan,
  clock: Clock,
): RunLimitCause | null {
  return exhaustedRunLimit({
    stepExecutions,
    elapsedMs: clock.now().getTime() - Date.parse(checkpoint.runStartedAt),
    tokens: checkpoint.tokens + checkpoint.reservedTokens,
  }, plan.limits);
}

/**
 * Execute one leased P-1 agent work stage. Browser and model I/O always sits outside a
 * transaction; every durable boundary rechecks the stage revision and Run state.
 */
export async function executeAgentWorkItem(
  dependencies: AgentWorkDependencies,
  job: AgentWorkItemJob,
): Promise<AgentWorkItemOutcome> {
  // A process can stop after persisting the wait intent but before creating the wait.
  // Re-delivery completes that handoff without repeating browser/model work.
  const pendingRaise = await dependencies.repository.transaction(job.runId, async context => {
    const checkpoint = context.checkpoint;
    if (context.run?.state !== 'RUNNING' || context.run.correlationId !== job.correlationId || job.schemaVersion !== 1 ||
        checkpoint?.status !== 'WAITING' || checkpoint.waitId !== null || checkpoint.pendingWait === null) return null;
    const item = context.workItems.find(item => item.workItemId === checkpoint.workItemId);
    if (!item) return null;
    const plan = await context.frozenPlan();
    if (plan && dependencies.clock.now().getTime() >= Date.parse(checkpoint.runStartedAt) + plan.limits.runTimeoutSeconds * 1000) {
      await context.saveCheckpoint({ ...checkpoint, status: 'TERMINAL', diagnostic: 'run-time-limit' }, 'INCONCLUSIVE');
      await completeRun(context, { run: context.run, state: 'INCONCLUSIVE', at: nowIso(dependencies.clock), plan });
      return null;
    }
    return { runId: job.runId, kind: checkpoint.pendingWait.kind, options: checkpoint.pendingWait.options,
      stepId: item.stepId, supportingEvidenceIds: item.evidenceId === null ? [] : [item.evidenceId] };
  });
  if (pendingRaise !== null) {
    await dependencies.waits.raiseEscalation(pendingRaise);
    return { retry: true };
  }
  const claim = await dependencies.repository.transaction(job.runId, async (context): Promise<AgentClaim | null> => {
    const run = context.run;
    if (!run || job.schemaVersion !== 1 || run.correlationId !== job.correlationId || run.state !== 'RUNNING') return null;
    if (!context.prerequisitesReady || context.workspace === null) {
      if (!context.prerequisitesReady) return null;
    }
    const prior = context.checkpoint;
    if (prior?.status === 'COMPLETE' || prior?.status === 'TERMINAL') return null;
    const now = dependencies.clock.now();
    if (prior?.status === 'EXECUTING' && Date.parse(prior.leaseUntil) > now.getTime()) return null;
    if ((prior?.status === 'WAITING' || prior?.status === 'RETRY') && context.wait?.closedAt === null) return null;

    const plan = await context.frozenPlan();
    if (plan === null) {
      const checkpoint: AgentWorkCheckpoint = {
        revision: (prior?.revision ?? 0) + 1,
        status: 'TERMINAL',
        runStartedAt: prior?.runStartedAt ?? context.population?.startedAt ?? now.toISOString(),
        leaseUntil: now.toISOString(),
        attemptId: dependencies.ids.next(),
        workItemId: null,
        waitId: null,
        pendingWait: null,
        nextTurn: prior?.nextTurn ?? 1,
        tokens: prior?.tokens ?? 0,
        reservedTokens: prior?.reservedTokens ?? 0,
        model: prior?.model ?? null,
        diagnostic: 'unsupported-frozen-plan',
      };
      await context.saveCheckpoint(checkpoint, 'RUN_FAILED');
      await appendEvent(context, run, 'unsupported-frozen-plan', 'RUN_FAILED', checkpoint, {}, 'failure');
      await completeRun(context, { run, state: 'RUN_FAILED', at: now.toISOString(), plan: null });
      return null;
    }
    const classification = classifyPlanTargets(plan);
    if (classification.unsupported !== null || classification.agents.some((entry) => entry.target.contract.kind !== 'web')) {
      const checkpoint: AgentWorkCheckpoint = {
        revision: (prior?.revision ?? 0) + 1,
        status: 'TERMINAL',
        runStartedAt: prior?.runStartedAt ?? context.population?.startedAt ?? now.toISOString(),
        leaseUntil: now.toISOString(),
        attemptId: dependencies.ids.next(),
        workItemId: null,
        waitId: null,
        pendingWait: null,
        nextTurn: prior?.nextTurn ?? 1,
        tokens: prior?.tokens ?? 0,
        reservedTokens: prior?.reservedTokens ?? 0,
        model: prior?.model ?? null,
        diagnostic: 'unsupported-frozen-plan',
      };
      await context.saveCheckpoint(checkpoint, 'RUN_FAILED');
      await appendEvent(context, run, 'unsupported-frozen-plan', 'RUN_FAILED', checkpoint, {}, 'failure');
      await completeRun(context, { run, state: 'RUN_FAILED', at: now.toISOString(), plan });
      return null;
    }
    if (classification.agents.length === 0) return null;
    if (context.workspace === null) {
      const checkpoint: AgentWorkCheckpoint = {
        revision: (prior?.revision ?? 0) + 1,
        status: 'TERMINAL',
        runStartedAt: prior?.runStartedAt ?? context.population?.startedAt ?? now.toISOString(),
        leaseUntil: now.toISOString(),
        attemptId: dependencies.ids.next(),
        workItemId: null,
        waitId: null,
        pendingWait: null,
        nextTurn: prior?.nextTurn ?? 1,
        tokens: prior?.tokens ?? 0,
        reservedTokens: prior?.reservedTokens ?? 0,
        model: prior?.model ?? null,
        diagnostic: 'workspace-missing',
      };
      await context.saveCheckpoint(checkpoint, 'RUN_FAILED');
      await appendEvent(context, run, 'workspace-missing', 'RUN_FAILED', checkpoint, {}, 'failure');
      await completeRun(context, { run, state: 'RUN_FAILED', at: now.toISOString(), plan });
      return null;
    }
    const records = await context.includedRecords();
    const primary = adapterLookupColumn(TEMPLATE_ID);
    if (primary === null) return null;
    const seen = new Set<string>();
    for (const record of records) {
      const value = record.values[primary];
      if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
        const checkpoint: AgentWorkCheckpoint = {
          revision: (prior?.revision ?? 0) + 1,
          status: 'TERMINAL',
          runStartedAt: prior?.runStartedAt ?? context.population?.startedAt ?? now.toISOString(),
          leaseUntil: now.toISOString(),
          attemptId: dependencies.ids.next(),
          workItemId: null,
          waitId: null,
          pendingWait: null,
          nextTurn: prior?.nextTurn ?? 1,
          tokens: prior?.tokens ?? 0,
          reservedTokens: prior?.reservedTokens ?? 0,
          model: prior?.model ?? null,
          diagnostic: 'unsupported-frozen-plan',
        };
        await context.saveCheckpoint(checkpoint, 'RUN_FAILED');
        await appendEvent(context, run, 'unsupported-frozen-plan', 'RUN_FAILED', checkpoint, {}, 'failure');
        await completeRun(context, { run, state: 'RUN_FAILED', at: now.toISOString(), plan });
        return null;
      }
      seen.add(value);
    }

    const created: WorkItemRecord[] = [];
    for (const entry of classification.agents) {
      for (const record of [...records].sort((left, right) => left.ordinal - right.ordinal)) {
        const subjectKey = record.values[primary];
        if (typeof subjectKey !== 'string' || subjectKey.length === 0) continue;
        const ordinal = created.length + 1;
        const existing = context.workItems.find((item) => item.stepId === entry.stepId && item.subjectKey === subjectKey);
        const item = existing ? { ...existing, ordinal } : {
          workItemId: dependencies.ids.next(),
          subjectKey,
          stepId: entry.stepId,
          ordinal,
          registrationId: entry.target.registrationId,
          displayName: entry.target.displayName,
          state: 'PENDING' as const,
          attempts: 0,
          cycles: 0,
          diagnostic: null,
          evidenceId: null,
          observations: 0,
        };
        created.push(item);
      }
    }
    created.sort((left, right) => left.ordinal - right.ordinal || left.workItemId.localeCompare(right.workItemId));

    let workItems = [...created];
    let runStartedAt = prior?.runStartedAt ?? context.population?.startedAt ?? now.toISOString();
    let current: AgentWorkCheckpoint = prior ?? {
      revision: 0,
      status: 'RETRY',
      runStartedAt,
      leaseUntil: now.toISOString(),
      attemptId: dependencies.ids.next(),
      workItemId: null,
      waitId: null,
      pendingWait: null,
      nextTurn: 1,
      tokens: 0,
      reservedTokens: 0,
      model: null,
      diagnostic: null,
    };

    // Keep a closed decision attached while its original captured Observation is being
    // completed. Claiming a lease is not consuming the human answer: a process may die
    // before registration, including during the model evaluation turn.
    const closedWait = context.wait && context.wait.closedAt !== null && context.wait.answerOptionId !== null ? context.wait : null;
    let decision: AgentClaim['decision'] = null;
    if (current.pendingWait !== null || current.waitId !== null) {
      if (closedWait === null || context.waitRaise === null || closedWait.waitId !== current.waitId ||
          closedWait.closureKind !== 'answer' || closedWait.actor === null || closedWait.answerOptionId === ESCALATION_OPTION_IDS.abort) return null;
      const item = workItems.find(candidate => candidate.workItemId === current.workItemId);
      if (item === undefined) return null;
      if (closedWait.kind === 'retry-or-skip' && closedWait.answerOptionId === ESCALATION_OPTION_IDS.retry) {
        // Retry grants a bounded cycle, not an Observation. The item and consumed grant
        // commit together here, so redelivery cannot increment the grant twice.
        item.state = 'IN_PROGRESS'; item.diagnostic = null;
        item.cycles = Math.min(2, item.cycles + 1);
        const retained = context.retainedDecisions ?? [];
        const resume = retained.find(entry => entry.wait.kind === 'unnamed-value') ?? retained.find(entry => entry.wait.kind === 'choose-candidate');
        if (resume) {
          const others = retained.filter(entry => entry.wait.waitId !== resume.wait.waitId);
          current = { ...current, waitId: resume.wait.waitId, pendingWait: { kind: resume.wait.kind, options: resume.wait.options, retainedDecisionWaitIds: others.map(entry => entry.wait.waitId) } };
          decision = { wait: resume.wait, raised: resume.raised, checkpoint: { ...current, status: 'WAITING' }, retained: others };
        } else current = { ...current, waitId: null, pendingWait: null };
      } else {
        decision = { wait: closedWait, checkpoint: { ...current, status: 'WAITING' }, raised: context.waitRaise, retained: context.retainedDecisions ?? [] };
      }
    }
    current = {
      ...current, revision: current.revision + 1, status: 'EXECUTING', runStartedAt,
      leaseUntil: new Date(Math.min(now.getTime() + plan.limits.stepTimeoutSeconds * 1000, Date.parse(runStartedAt) + plan.limits.runTimeoutSeconds * 1000)).toISOString(),
      attemptId: dependencies.ids.next(), diagnostic: null,
    };
    const next = workItems.find((item) => !isTerminalWorkItem(item));
    current = { ...current, workItemId: next?.workItemId ?? null };
    // The checkpoint has an immediate foreign key to its next Work Item. Both writes
    // share this transaction; persist the referenced rows before publishing the claim.
    for (const item of workItems) await context.saveWorkItem(item);
    await context.saveCheckpoint(current, 'RUNNING');
    return {
      checkpoint: current,
      plan,
      run,
      workspace: context.workspace,
      targets: classification.agents,
      records,
      items: workItems,
      evidence: context.evidence,
      toolActions: context.toolActions,
      captures: context.captures,
      stepExecutions: await context.readStepExecutionCount(),
      decision,
    };
  });

  if (claim === null) return { retry: false };

  let checkpoint = claim.checkpoint;
  let humanDecision = claim.decision;
  const { plan, run, workspace, targets, records } = claim;
  let stepExecutions = claim.stepExecutions;
  const runDeadline = Date.parse(checkpoint.runStartedAt) + plan.limits.runTimeoutSeconds * 1000;
  const stepTimeoutMs = plan.limits.stepTimeoutSeconds * 1000;
  const now = (): number => dependencies.clock.now().getTime();
  const budget = (): number => {
    const remaining = Math.min(Date.parse(checkpoint.leaseUntil), runDeadline, now() + stepTimeoutMs) - now();
    if (remaining <= 0) throw new BrowserActionError('unavailable');
    return remaining;
  };
  const guarded = async (work: (context: AgentWorkContext) => Promise<void>): Promise<boolean> =>
    dependencies.repository.transaction(run.runId, async (context) => {
      if (context.checkpoint?.revision !== checkpoint.revision || context.checkpoint.status !== 'EXECUTING' || context.run?.state !== 'RUNNING') return false;
      await work(context);
      return true;
    });

  /** Check cancellation at every Tool Action boundary without crossing a lost claim. */
  const cancellationBoundary = async (): Promise<'continue' | 'canceled' | 'lost'> => {
    let canceled = false;
    const committed = await guarded(async (context) => {
      const request = context.run?.cancellation ?? null;
      if (request === null) return;
      canceled = true;
      await performCancellation(context, {
        run,
        request,
        at: nowIso(dependencies.clock),
        plan,
        source: 'worker',
      });
    });
    if (!committed) return 'lost';
    return canceled ? 'canceled' : 'continue';
  };

  const stopWithin = async (context: AgentWorkContext, diagnostic: AgentWorkDiagnostic, cause: RunLimitCause | 'action-denied' | 'scope-violation' | 'session-step-failed'): Promise<void> => {
    const decision = runStopFor(cause);
    const next: AgentWorkCheckpoint = { ...checkpoint, status: 'TERMINAL', diagnostic, leaseUntil: nowIso(dependencies.clock) };
    await context.saveCheckpoint(next, decision.state);
    await appendEvent(context, run, diagnostic, decision.state, next, {}, 'failure');
    if (decision.securityEvent) {
      const security = await context.auditEvents.append({
        actor: { type: 'system', id: 'agent-worker' }, eventType: SECURITY_DENIED_EVENT,
        source: 'worker', outcome: 'denied', aggregateId: run.runId,
        correlationId: run.correlationId, sessionId: run.sessionId,
        payload: { cause, diagnostic, state: decision.state, workItemId: checkpoint.workItemId },
      });
      await context.notifyTimeline(security.sequence);
    }
    await completeRun(context, { run, state: decision.state, at: nowIso(dependencies.clock), plan });
  };

  const stopRun = async (diagnostic: AgentWorkDiagnostic, cause: RunLimitCause | 'action-denied' | 'scope-violation' | 'session-step-failed' = 'session-step-failed'): Promise<void> => {
    await guarded(context => stopWithin(context, diagnostic, cause));
  };

  // Recheck under the Run lock: capture/model I/O and lock acquisition can consume
  // the remaining budget even when the action began within the approved limit.
  const stopAtFinalLimit = async (context: AgentWorkContext): Promise<boolean> => {
    const cause = runLimit(stepExecutions, checkpoint, plan, dependencies.clock);
    if (cause === null) return false;
    await stopWithin(context, cause, cause);
    return true;
  };

  const retainedBusinessDecisions = (): readonly string[] => {
    if (humanDecision === null) return [];
    return [...new Set([...humanDecision.retained.map(entry => entry.wait.waitId),
      ...(humanDecision.wait.kind === 'retry-or-skip' ? [] : [humanDecision.wait.waitId])])];
  };

  const persistRetry = async (
    item: WorkItemRecord,
    execution: StepExecutionRecord,
    diagnostic: AgentWorkDiagnostic,
  ): Promise<'retry' | 'wait' | 'lost'> => {
    const attemptsPerCycle = plan.limits.retriesPerStep + 1;
    const exhausted = item.attempts % attemptsPerCycle === 0;
    const maxAttempts = attemptsPerCycle * 2;
    if (item.attempts >= maxAttempts || (exhausted && item.cycles >= 2)) {
      item.state = 'FAILED';
      item.diagnostic = diagnostic;
    } else if (exhausted) {
      item.state = 'AWAITING';
      item.diagnostic = diagnostic;
    } else {
      item.state = 'IN_PROGRESS';
      item.diagnostic = diagnostic;
    }
    item.cycles = Math.min(2, Math.max(item.cycles, Math.ceil(item.attempts / attemptsPerCycle)));
    if (item.state === 'AWAITING') {
      const options = optionForKind('retry-or-skip', []);
      const next: AgentWorkCheckpoint = {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        status: 'WAITING',
        leaseUntil: nowIso(dependencies.clock),
        workItemId: item.workItemId,
        waitId: null,
        pendingWait: { kind: 'retry-or-skip', options, retainedDecisionWaitIds: retainedBusinessDecisions() },
        diagnostic,
      };
      const saved = await guarded(async (context) => {
        await context.saveWorkItem(item);
        await context.saveStepExecution({ ...execution, state: 'FAILED', completedAt: nowIso(dependencies.clock), diagnostic });
        await context.saveCheckpoint(next, 'RUNNING');
        await appendEvent(context, run, diagnostic, 'RUNNING', next, { stepExecutionId: execution.stepExecutionId }, 'failure');
      });
      if (!saved) return 'lost';
      checkpoint = next;
      const raised = await dependencies.waits.raiseEscalation({
        runId: run.runId,
        kind: 'retry-or-skip',
        options,
        stepId: item.stepId,
        supportingEvidenceIds: item.evidenceId === null ? [] : [item.evidenceId],
      });
      if (raised.ok) {
        const attached = await dependencies.repository.transaction(run.runId, async (context) => {
          if (context.checkpoint?.revision !== checkpoint.revision || context.checkpoint.status !== 'WAITING' || context.run?.state !== 'AWAITING_AUDITOR') return false;
          await context.saveCheckpoint({ ...checkpoint, waitId: raised.wait.waitId }, 'AWAITING_AUDITOR');
          return true;
        });
        if (attached) checkpoint = { ...checkpoint, waitId: raised.wait.waitId };
      }
      return 'wait';
    }
    const next: AgentWorkCheckpoint = {
      ...checkpoint,
      revision: checkpoint.revision + 1,
      status: item.state === 'FAILED' ? 'EXECUTING' : 'RETRY',
      leaseUntil: item.state === 'FAILED' ? checkpoint.leaseUntil : nowIso(dependencies.clock),
      workItemId: item.state === 'FAILED' ? null : item.workItemId,
      ...(item.state === 'FAILED' ? { waitId: null, pendingWait: null } : {}),
      diagnostic,
    };
    const saved = await guarded(async (context) => {
      await context.saveWorkItem(item);
      await context.saveStepExecution({ ...execution, state: 'FAILED', completedAt: nowIso(dependencies.clock), diagnostic });
      await context.saveCheckpoint(next, 'RUNNING');
      await appendEvent(context, run, diagnostic, 'RUNNING', next, { stepExecutionId: execution.stepExecutionId }, 'failure');
    });
    if (!saved) return 'lost';
    checkpoint = next;
    if (item.state === 'FAILED') humanDecision = null;
    return 'retry';
  };

  // A normal retry checkpoint is no longer executable by this invocation. Returning to
  // the queue lets the next claim acquire it after the lease boundary; a maxed item is
  // terminal while the checkpoint remains EXECUTING so this invocation may advance to
  // the next Work Item.
  const retryOutcome = (result: 'retry' | 'wait' | 'lost'): AgentWorkItemOutcome | null => {
    if (result === 'lost') return { retry: false };
    if (result === 'wait') return { retry: true };
    return checkpoint.status === 'RETRY' ? { retry: true } : null;
  };

  const persistWait = async (input: {
    readonly item: WorkItemRecord;
    readonly execution: StepExecutionRecord;
    readonly kind: EscalationKind;
    readonly options: readonly EscalationOption[];
    readonly diagnostic: 'ambiguous-match' | 'insufficient-evidence' | 'unnamed-value';
    readonly supportingEvidenceIds: readonly string[];
  }): Promise<AgentWorkItemOutcome> => {
    input.item.evidenceId = input.supportingEvidenceIds[0] ?? input.item.evidenceId;
    if (input.kind === 'retry-or-skip' && input.item.cycles >= 2) {
      // The auditor already granted the one extra cycle. Preserve the evidence and
      // honest failed Work Item; another answer must not authorize a third cycle.
      input.item.state = 'FAILED';
      input.item.diagnostic = input.diagnostic;
      const next: AgentWorkCheckpoint = { ...checkpoint, revision: checkpoint.revision + 1,
        status: 'RETRY', leaseUntil: nowIso(dependencies.clock), workItemId: null,
        waitId: null, pendingWait: null, diagnostic: input.diagnostic };
      const saved = await guarded(async context => {
        await context.saveWorkItem(input.item);
        await context.saveStepExecution({ ...input.execution, state: 'FAILED', completedAt: nowIso(dependencies.clock), diagnostic: input.diagnostic });
        await context.saveCheckpoint(next, 'RUNNING');
        await appendEvent(context, run, input.diagnostic, 'RUNNING', next, { stepExecutionId: input.execution.stepExecutionId }, 'failure');
      });
      if (saved) { checkpoint = next; humanDecision = null; }
      return { retry: saved };
    }
    if (input.kind === 'retry-or-skip') input.item.cycles = Math.max(1, input.item.cycles);
    input.item.state = 'AWAITING';
    input.item.diagnostic = input.diagnostic;
    const waiting: AgentWorkCheckpoint = {
      ...checkpoint,
      revision: checkpoint.revision + 1,
      status: 'WAITING',
      leaseUntil: nowIso(dependencies.clock),
      workItemId: input.item.workItemId,
      waitId: null,
      pendingWait: { kind: input.kind, options: input.options, retainedDecisionWaitIds: retainedBusinessDecisions() },
      diagnostic: input.diagnostic,
    };
    const saved = await guarded(async (context) => {
      await context.saveWorkItem(input.item);
      await context.saveStepExecution({ ...input.execution, state: 'FAILED', completedAt: nowIso(dependencies.clock), diagnostic: input.item.diagnostic });
      await context.saveCheckpoint(waiting, 'RUNNING');
      await appendEvent(context, run, input.diagnostic, 'RUNNING', waiting, { stepExecutionId: input.execution.stepExecutionId }, 'failure');
    });
    if (!saved) return { retry: false };
    checkpoint = waiting;
    const raised = await dependencies.waits.raiseEscalation({
      runId: run.runId,
      kind: input.kind,
      options: input.options,
      stepId: input.item.stepId,
      supportingEvidenceIds: input.supportingEvidenceIds,
    });
    if (raised.ok) {
      const attached = await dependencies.repository.transaction(run.runId, async (context) => {
        if (context.checkpoint?.revision !== checkpoint.revision || context.checkpoint.status !== 'WAITING' || context.run?.state !== 'AWAITING_AUDITOR') return false;
        await context.saveCheckpoint({ ...checkpoint, waitId: raised.wait.waitId }, 'AWAITING_AUDITOR');
        return true;
      });
      if (attached) checkpoint = { ...checkpoint, waitId: raised.wait.waitId };
    }
    return { retry: true };
  };

  const finishObservation = async (
    item: WorkItemRecord,
    execution: StepExecutionRecord,
    observation: ReturnType<typeof buildFoundAgentObservation> | ReturnType<typeof buildAbsentAgentObservation>,
    snapshot: StoredSnapshot,
    state: 'OBSERVED' | 'UNINSPECTED',
  ): Promise<'done' | 'lost' | 'refused'> => {
    if (observation === null) return 'refused';
    const priorObservations = item.observations;
    const corroboration = snapshotCorroboration([snapshot]);
    const agentInputs = { plan, records, references: [] };
    const evaluation = ruleEvaluation(agentInputs);
    if (observation.record.found === 'true' && !(humanDecision !== null && [humanDecision.wait, ...humanDecision.retained.map(entry => entry.wait)].some(wait => wait.kind === 'unnamed-value' && wait.answerOptionId === ESCALATION_OPTION_IDS.markUnevaluated))) {
      let registeredEvidenceIds: string[] = [];
      if (!await guarded(async context => { registeredEvidenceIds = (await context.readEvidenceStates(observation.record.evidenceIds)).filter(row => row.state === 'REGISTERED').map(row => row.evidenceId); })) return 'lost';
      const [verdict] = await corroboration.corroborate([observation.record]);
      if (verdict === undefined) return 'refused';
      const judged = { ...observation.record,
        identity: observation.record.identity === null ? null : { ...observation.record.identity, corroboration: verdict.identity },
        attributes: observation.record.attributes.map(attribute => ({ ...attribute, corroboration: verdict.attributes.find(entry => entry.name === attribute.name)?.corroboration ?? null })) };
      const checks = [...observationChecks({ ...observation, record: judged, registeredEvidenceIds, runStartedAt: checkpoint.runStartedAt, registeredAt: nowIso(dependencies.clock) }),
        { check: 'observation-corroboration' as const, outcome: verdict.outcome, diagnostic: verdict.diagnostic }];
      const [preview] = await evaluation.evaluate([{ record: judged,
        coverage: observationCoverage({ ...observation, record: judged, registeredEvidenceIds, coverageRule: findProcedureTemplate(plan.inputs.templateId).coverageRule }),
        corroboration: observationCorroborationState(judged), checks }]);
      if (preview?.evaluations.some(row => row.origin === 'RULE' && row.value === 'UNEVALUATED' && row.diagnostic?.startsWith(RULE_DOES_NOT_NAME_VALUE))) {
        await persistWait({ item, execution, kind: 'unnamed-value', options: FIXED_ESCALATION_OPTIONS['unnamed-value'], diagnostic: 'unnamed-value', supportingEvidenceIds: [snapshot.evidenceId] });
        return 'lost';
      }
    }
    const agentEvaluation = agentRuleEvaluation(agentInputs);
    const expectedConditionIds = plan.inputs.complianceConditions.map(({ conditionId }) => conditionId);
    const expectedAgentConditionIds = plan.inputs.complianceConditions.filter(({ status }) => status === 'AGENT_JUDGED').map(({ conditionId }) => conditionId);
    const applicableIds = new Set(applicableAgentConditionIds(agentInputs, observation.record));
    const conditions = plan.inputs.complianceConditions
      .filter(({ conditionId, status }) => status === 'AGENT_JUDGED' && applicableIds.has(conditionId))
      .map(({ conditionId, text }) => ({ conditionId, text }));
    let agentProposals: readonly AgentJudgedProposal[] = [];
    if (observation.record.found === 'true' && conditions.length > 0) {
      if (dependencies.model === null) return 'refused';
      const primary = adapterLookupColumn(plan.inputs.templateId);
      const population = primary === null ? null : records.find(record => record.values[primary] === observation.record.populationRecordKey) ?? null;
      const turn = await executeAgentModelTurn({ plan, checkpoint,
        request: { schemaVersion: 1, phase: 'evaluation',
          objective: 'Evaluate only the supplied frozen conditions against the final captured Observation and frozen population context.',
          retrieved: [], tools: [],
          evaluation: { observationId: observation.record.observationId,
            observation: { source: `snapshot:${snapshot.evidenceId}`, text: JSON.stringify({ observation: observation.record, population, period: run.period }) },
            conditions }, timeoutMs: Math.max(1, budget()) },
        gateway: dependencies.model, guard: agentGuard, workItemId: item.workItemId,
        stepExecutionId: execution.stepExecutionId, snapshotEvidenceId: snapshot.evidenceId, commit: guarded });
      if (turn.kind === 'lost') return 'lost';
      if (turn.kind === 'limit') { await stopRun('run-token-limit', 'run-token-limit'); return 'lost'; }
      if (turn.kind !== 'completed' && turn.kind !== 'failed') return 'lost';
      checkpoint = turn.checkpoint;
      if (turn.kind === 'failed') return 'refused';
      const spentLimit = runLimit(stepExecutions, checkpoint, plan, dependencies.clock);
      if (spentLimit !== null) {
        await stopRun(spentLimit === 'run-time-limit' ? 'run-time-limit' : spentLimit === 'run-step-execution-limit' ? 'run-step-execution-limit' : 'run-token-limit', spentLimit);
        return 'lost';
      }
      if (turn.response.phase !== 'evaluation' || turn.response.agentProposals === undefined) return 'refused';
      if (turn.response.uncertainty.kind !== 'none') {
        await persistWait({ item, execution, kind: 'retry-or-skip', options: FIXED_ESCALATION_OPTIONS['retry-or-skip'], diagnostic: 'insufficient-evidence', supportingEvidenceIds: [snapshot.evidenceId] });
        return 'lost';
      }
      agentProposals = turn.response.agentProposals;
      if (await cancellationBoundary() !== 'continue') return 'lost';
    }
    item.state = state;
    item.observations += 1;
    item.evidenceId = snapshot.evidenceId;
    item.diagnostic = state === 'UNINSPECTED' ? 'insufficient-evidence' : null;
    try {
      let limited = false;
      const saved = await guarded(async (context) => {
        if (await stopAtFinalLimit(context)) { limited = true; return; }
        await registerObservations(context, {
          run,
          workItemId: item.workItemId,
          stepExecutionId: execution.stepExecutionId,
          targetSystem: item.registrationId,
          templateId: plan.inputs.templateId,
          runStartedAt: checkpoint.runStartedAt,
          registeredAt: nowIso(dependencies.clock),
          items: [observation], agentProposals, expectedConditionIds, expectedAgentConditionIds,
        }, { corroboration, evaluation, agentEvaluation, exceptions: dependencies.exceptions });
        await context.saveWorkItem(item);
        if (humanDecision !== null && humanDecision.checkpoint.workItemId === item.workItemId) {
          await context.saveCheckpoint({ ...checkpoint, waitId: null, pendingWait: null }, 'RUNNING');
        }
        await context.saveStepExecution({ ...execution, state: 'SUCCEEDED', completedAt: nowIso(dependencies.clock), diagnostic: item.diagnostic });
        await appendEvent(context, run, state === 'OBSERVED' ? 'work-item-observed' : 'work-item-uninspected', 'RUNNING', checkpoint, {
          workItemId: item.workItemId,
          stepExecutionId: execution.stepExecutionId,
          evidenceId: snapshot.evidenceId,
          observations: item.observations,
        });
      });
      if (!saved || limited) {
        item.observations = priorObservations;
        return 'lost';
      }
      if (humanDecision !== null && humanDecision.checkpoint.workItemId === item.workItemId) {
        checkpoint = { ...checkpoint, waitId: null, pendingWait: null }; humanDecision = null;
      }
      return 'done';
    } catch {
      item.observations = priorObservations;
      return 'refused';
    }
  };

  if (dependencies.model === null) {
    await stopRun('model-not-configured', 'session-step-failed');
    return { retry: false };
  }

  // Rehydrate the guard from the frozen references before any capture or model I/O. A
  // persisted Work Item can outlive the in-memory guard held by sign-in, so accepting an
  // empty caller-supplied guard here would let post-restart Evidence and model requests
  // escape credential scanning. The wrapped resolver holds only opaque ResolvedCredential
  // objects and the values never enter this stage.
  const { credentials: guardedResolver, guard: agentGuard } = guardedCredentials(dependencies.credentials);
  const resolveFrozenCredentials = async (): Promise<void> => {
    const references = new Set<string>();
    for (const entry of plan.credentialReferences) {
      if (typeof entry.credentialRef !== 'string' || entry.credentialRef.length === 0) throw new AgentCredentialError();
      references.add(entry.credentialRef);
    }
    for (const reference of references) {
      try {
        const credential = await guardedResolver.resolve(reference, budget());
        if (credential.reference !== reference) throw new AgentCredentialError();
      } catch (error) {
        if (error instanceof AgentCredentialError || error instanceof BrowserActionError) throw error;
        throw new AgentCredentialError();
      }
    }
  };

  const items = claim.items.map((item) => ({ ...item }));
  const targetForItem = (item: WorkItemRecord): ClassifiedTarget | null => targets.find((entry) => entry.stepId === item.stepId) ?? null;
  const recordForItem = (item: WorkItemRecord): PopulationRecord | null => {
    const primary = adapterLookupColumn(TEMPLATE_ID);
    return primary === null ? null : records.find((record) => record.values[primary] === item.subjectKey) ?? null;
  };

  try {
    await resolveFrozenCredentials();
    for (const item of items.sort((left, right) => left.ordinal - right.ordinal)) {
      if (isTerminalWorkItem(item)) continue;
      const itemBoundary = await cancellationBoundary();
      if (itemBoundary !== 'continue') return { retry: false };
      const entry = targetForItem(item);
      const record = recordForItem(item);
      if (entry === null || record === null) {
        item.state = 'FAILED'; item.diagnostic = 'unsupported-frozen-plan';
        continue;
      }
      if (runLimit(stepExecutions, checkpoint, plan, dependencies.clock) !== null) {
        const cause = runLimit(stepExecutions, checkpoint, plan, dependencies.clock)!;
        await stopRun(cause === 'run-time-limit' ? 'run-time-limit' : cause === 'run-token-limit' ? 'run-token-limit' : 'run-step-execution-limit', cause);
        return { retry: false };
      }
      item.attempts += 1;
      const execution: StepExecutionRecord = {
        stepExecutionId: (stepExecutions += 1, dependencies.ids.next()),
        planStepId: item.stepId,
        workItemId: item.workItemId,
        action: INSPECT_ACTION,
        state: 'RUNNING',
        attempt: item.attempts,
        startedAt: nowIso(dependencies.clock),
        completedAt: null,
        diagnostic: null,
      };
      checkpoint = checkpointLease({ ...checkpoint, workItemId: item.workItemId, diagnostic: null }, dependencies.clock, plan);
      const started = await guarded(async (context) => {
        await context.saveCheckpoint(checkpoint, 'RUNNING');
        await context.saveWorkItem({ ...item, state: 'IN_PROGRESS', diagnostic: null });
        await context.saveStepExecution(execution);
        await appendEvent(context, run, 'work-item-attempt-started', 'RUNNING', checkpoint, {
          workItemId: item.workItemId, stepExecutionId: execution.stepExecutionId, attempt: item.attempts,
        });
      });
      if (!started) return { retry: false };
      item.state = 'IN_PROGRESS'; item.diagnostic = null;

      if (humanDecision !== null && humanDecision.checkpoint.workItemId === item.workItemId) {
        const raisedIds = humanDecision.raised.supportingEvidenceIds;
        const binding = claim.captures.find(capture => raisedIds.includes(capture.evidenceId) &&
          claim.evidence.some(evidence => evidence.evidenceId === capture.evidenceId && evidence.kind === 'structural-snapshot') &&
          claim.toolActions.some(action => action.toolActionId === capture.toolActionId && action.workItemId === item.workItemId && action.targetSystem === item.registrationId));
        // A failed attempt that never captured anything can be skipped honestly without
        // fabricating an Observation. The missing coverage still fails the shared Gate.
        if (binding === undefined && humanDecision.wait.kind === 'retry-or-skip' && humanDecision.wait.answerOptionId === ESCALATION_OPTION_IDS.skip && raisedIds.length === 0) {
          item.state = 'UNINSPECTED'; item.diagnostic = 'insufficient-evidence';
          if (!await guarded(async context => {
            await context.saveWorkItem(item); await context.saveStepExecution({ ...execution, state: 'SUCCEEDED', completedAt: nowIso(dependencies.clock), diagnostic: item.diagnostic });
            await context.saveCheckpoint({ ...checkpoint, waitId: null, pendingWait: null }, 'RUNNING');
          })) return { retry: false };
          checkpoint = { ...checkpoint, waitId: null, pendingWait: null }; humanDecision = null; continue;
        }
        const original = binding === undefined ? null : await readSnapshotForBinding(dependencies.store, binding, claim.evidence, budget);
        const evidence = original === null ? undefined : claim.evidence.find(row => row.evidenceId === original.evidenceId);
        if (binding === undefined || original === null || evidence === undefined) {
          await stopRun('human-decision-refused', 'session-step-failed'); return { retry: false };
        }
        const selectedDecision = humanDecision.wait.answerOptionId === ESCALATION_OPTION_IDS.skip ? undefined : humanDecision.retained.find(retained => retained.wait.kind === 'choose-candidate');
        // Every retained business decision must concern this very item's original capture.
        if (humanDecision.retained.some(retained => retained.raised.stepId !== item.stepId || !retained.raised.supportingEvidenceIds.includes(original.evidenceId))) {
          await stopRun('human-decision-refused', 'session-step-failed'); return { retry: false };
        }
        const chosenWait = selectedDecision?.wait ?? humanDecision.wait;
        const chosenRaise = selectedDecision?.raised ?? humanDecision.raised;
        const chosenCheckpoint = selectedDecision === undefined ? humanDecision.checkpoint : {
          ...humanDecision.checkpoint, waitId: chosenWait.waitId, pendingWait: { kind: chosenWait.kind, options: chosenWait.options },
        };
        const applied = applyAgentHumanDecision({ runId: run.runId, wait: chosenWait,
          checkpoint: chosenCheckpoint, raised: chosenRaise, plan, target: entry.target,
          population: record, workItem: item, stepExecutionId: execution.stepExecutionId,
          snapshot: original, snapshotEvidence: evidence, sourceLocation: binding.sourceLocation,
          observedAt: evidence.capturedAt ?? nowIso(dependencies.clock) });
        if (!applied.ok || applied.kind !== 'register') {
          await stopRun('human-decision-refused', 'session-step-failed'); return { retry: false };
        }
        const finished = await finishObservation(item, execution, applied.item, original, applied.workItemState);
        if (finished === 'lost') return { retry: checkpoint.status === 'RETRY' };
        if (finished === 'refused') {
          // Preserve the choice across a retry. It is consumed only with registration.
          const result = await persistRetry(item, execution, 'observation-registration-refused');
          const outcome = retryOutcome(result); if (outcome !== null) return outcome;
        }
        continue;
      }
      // A persisted snapshot remains Evidence, but is not the live browser's current page
      // after a provider attach/restart. Re-establish navigation and searches in this attempt.
      let current: SnapshotState | null = null;
      let searches: AgentSearchEvidence[] = [];
      if (current === null) {
        const bootstrapBoundary = await cancellationBoundary();
        if (bootstrapBoundary !== 'continue') return { retry: false };
        const destination = safeOrigin(entry.target);
        if (destination === null) {
          const result = await persistRetry(item, execution, 'unsupported-frozen-plan');
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          continue;
        }
        const actionId = dependencies.ids.next();
        const performed = await performToolAction(dependencies.browser, {
          ref: workspace,
          runId: run.runId,
          stepExecutionId: execution.stepExecutionId,
          workItemId: item.workItemId,
          toolActionId: actionId,
          scope: { target: entry.target, scopeValues: stringScope(record) },
          request: { action: 'navigate', destination, parameters: [] },
          credential: null,
          requestedCapture: ['structural-snapshot', 'screenshot'],
          startedAt: nowIso(dependencies.clock),
          completedAt: () => nowIso(dependencies.clock),
          timeoutMs: budget,
          guard: agentGuard,
        });
        const savedAction = await guarded(async (context) => { await context.saveToolAction(performed.action); });
        if (!savedAction) return { retry: false };
        if (!performed.ok) {
          const diagnostic = actionDiagnostic(performed.diagnostic);
          if (terminalSecurityCause(performed.diagnostic) !== null) {
            await stopRun(diagnostic, terminalSecurityCause(performed.diagnostic)!);
            return { retry: false };
          }
          const result = await persistRetry(item, execution, diagnostic);
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          continue;
        }
        let capture: Awaited<ReturnType<typeof freezeAgentCapture>>;
        try {
          capture = await freezeAgentCapture({
            runId: run.runId,
            targetSystem: entry.target.registrationId,
            templateId: plan.inputs.templateId,
            toolActionId: performed.action.toolActionId,
            sourceLocation: performed.action.destination,
            artifacts: performed.artifacts,
            store: dependencies.store,
            guard: agentGuard,
            budget,
            now: () => nowIso(dependencies.clock),
            commit: guarded,
          });
        } catch (error) {
          const diagnostic = failureDiagnostic(error);
          const result = await persistRetry(item, execution, diagnostic);
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          continue;
        }
        if (capture === null) return { retry: false };
        current = { snapshot: capture.snapshot, sourceLocation: performed.action.destination, screenshotEvidenceId: capture.screenshotEvidenceId };
        item.evidenceId = capture.snapshot.evidenceId;
      }

      let actionsConsumed = 0;
      while (actionsConsumed < MAX_ACTIONS_PER_TURN) {
        const modelBoundary = await cancellationBoundary();
        if (modelBoundary !== 'continue') return { retry: false };
        const planned = planAgentTools({
          plan,
          target: entry.target,
          population: record,
          snapshot: current.snapshot,
          sourceLocation: current.sourceLocation,
          searches,
        });
        if (planned.absenceReady) {
          const queryKeys = currentSearchQueryKeys(searches, entry.target, record);
          const observation = buildAbsentAgentObservation({
            plan, target: entry.target, population: record, workItemId: item.workItemId,
            stepExecutionId: execution.stepExecutionId, snapshot: current.snapshot,
            queryKeys, searchEvidenceIds: searches.map((search) => search.snapshot.evidenceId),
            screenshotEvidenceId: current.screenshotEvidenceId, observedAt: nowIso(dependencies.clock),
          });
          const finished = await finishObservation(item, execution, observation, current.snapshot, 'OBSERVED');
          if (finished === 'lost') return { retry: checkpoint.status === 'RETRY' };
          if (finished === 'refused') {
            const result = await persistRetry(item, execution, 'observation-registration-refused');
            const outcome = retryOutcome(result);
            if (outcome !== null) return outcome;
          }
          break;
        }
        // A grounded duplicate or name-only candidate is a platform-detected ambiguity.
        // It must stop for a typed human choice before any model proposal is considered;
        // an empty tool list is not permission to let the model guess.
        if (planned.tools.length === 0 && planned.candidates.length > 0) {
          return persistWait({
            item,
            execution,
            kind: 'choose-candidate',
            options: optionForKind('choose-candidate', planned.candidates),
            diagnostic: 'ambiguous-match',
            supportingEvidenceIds: [current.snapshot.evidenceId],
          });
        }
        const request: AgentModelRequest = {
          schemaVersion: 1,
          objective: targetStepText(plan, entry.target),
          retrieved: [{ source: `web-tree:${current.snapshot.evidenceId}`, text: decodeSnapshot(current.snapshot) }],
          tools: planned.tools,
          timeoutMs: Math.max(1, budget()),
        };
        const turn = await executeAgentModelTurn({
          plan, checkpoint, request, gateway: dependencies.model, guard: agentGuard,
          workItemId: item.workItemId, stepExecutionId: execution.stepExecutionId,
          snapshotEvidenceId: current.snapshot.evidenceId, commit: guarded,
        });
        if (turn.kind === 'lost') return { retry: false };
        if (turn.kind === 'limit') {
          const cause = runLimit(stepExecutions, checkpoint, plan, dependencies.clock) ?? 'run-token-limit';
          await stopRun(cause === 'run-time-limit' ? 'run-time-limit' : cause === 'run-step-execution-limit' ? 'run-step-execution-limit' : 'run-token-limit', cause);
          return { retry: false };
        }
        if (turn.kind === 'failed') {
          checkpoint = turn.checkpoint;
          const result = await persistRetry(item, execution, modelDiagnostic(turn.diagnostic));
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          break;
        }
        if (turn.kind !== 'completed') return { retry: false };
        checkpoint = turn.checkpoint;
        // Provider usage is an observed fact, not an estimate. If it exceeded the Run
        // budget, no browser action from that response may execute.
        const spentLimit = runLimit(stepExecutions, checkpoint, plan, dependencies.clock);
        if (spentLimit !== null) {
          await stopRun(spentLimit === 'run-time-limit' ? 'run-time-limit' : spentLimit === 'run-step-execution-limit' ? 'run-step-execution-limit' : 'run-token-limit', spentLimit);
          return { retry: false };
        }
        const responseBoundary = await cancellationBoundary();
        if (responseBoundary !== 'continue') return { retry: false };
        const response: AgentModelResponse = turn.response;
        if (response.uncertainty.kind !== 'none') {
          const kind: EscalationKind = response.uncertainty.kind === 'ambiguous' && planned.candidates.length > 0
            ? 'choose-candidate' : 'retry-or-skip';
          const options = optionForKind(kind, planned.candidates);
          return persistWait({
            item,
            execution,
            kind,
            options,
            diagnostic: response.uncertainty.kind === 'ambiguous' ? 'ambiguous-match' : 'insufficient-evidence',
            supportingEvidenceIds: [current.snapshot.evidenceId],
          });
        }
        if (response.actions.length === 0) {
          if (completeZero(current.snapshot)) {
            const observation = buildAbsentAgentObservation({
              plan, target: entry.target, population: record, workItemId: item.workItemId,
              stepExecutionId: execution.stepExecutionId, snapshot: current.snapshot,
              queryKeys: currentSearchQueryKeys(searches, entry.target, record),
              searchEvidenceIds: searches.map((search) => search.snapshot.evidenceId),
              screenshotEvidenceId: current.screenshotEvidenceId, observedAt: nowIso(dependencies.clock),
            });
            const finished = await finishObservation(item, execution, observation, current.snapshot, 'UNINSPECTED');
            if (finished === 'lost') return { retry: checkpoint.status === 'RETRY' };
            if (finished === 'refused') {
              const result = await persistRetry(item, execution, 'observation-registration-refused');
              const outcome = retryOutcome(result);
              if (outcome !== null) return outcome;
            }
            break;
          }
          const result = await persistRetry(item, execution, 'model-no-proposal');
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          break;
        }
        const first = response.actions[0];
        if (first === undefined) break;
        const selected = targetTool(planned, first.toolId);
        // The planner supplies scoped search parameters. Model-authored substitutions
        // are forbidden, even if ignoring them would happen to yield an allowed read.
        if (first.parameters.length !== 0) {
          await stopRun('model-invalid-action', 'action-denied');
          return { retry: false };
        }
        if (selected === null) {
          const result = await persistRetry(item, execution, 'model-invalid-action');
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          break;
        }
        const actionBoundary = await cancellationBoundary();
        if (actionBoundary !== 'continue') return { retry: false };
        const actionId = dependencies.ids.next();
        const performed = await performToolAction(dependencies.browser, {
          ref: workspace,
          runId: run.runId,
          stepExecutionId: execution.stepExecutionId,
          workItemId: item.workItemId,
          toolActionId: actionId,
          scope: { target: entry.target, scopeValues: stringScope(record) },
          request: { action: selected.action, destination: selected.destination, parameters: selected.parameters },
          credential: null,
          requestedCapture: ['structural-snapshot', 'screenshot'],
          startedAt: nowIso(dependencies.clock),
          completedAt: () => nowIso(dependencies.clock),
          timeoutMs: budget,
          guard: agentGuard,
        });
        const savedAction = await guarded(async (context) => { await context.saveToolAction(performed.action); });
        if (!savedAction) return { retry: false };
        if (!performed.ok) {
          const diagnostic = actionDiagnostic(performed.diagnostic);
          if (terminalSecurityCause(performed.diagnostic) !== null) {
            await stopRun(diagnostic, terminalSecurityCause(performed.diagnostic)!);
            return { retry: false };
          }
          const result = await persistRetry(item, execution, diagnostic);
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          break;
        }
        let capture: Awaited<ReturnType<typeof freezeAgentCapture>>;
        try {
          capture = await freezeAgentCapture({
            runId: run.runId,
            targetSystem: entry.target.registrationId,
            templateId: plan.inputs.templateId,
            toolActionId: performed.action.toolActionId,
            sourceLocation: performed.action.destination,
            artifacts: performed.artifacts,
            store: dependencies.store,
            guard: agentGuard,
            budget,
            now: () => nowIso(dependencies.clock),
            commit: guarded,
          });
        } catch (error) {
          const result = await persistRetry(item, execution, failureDiagnostic(error));
          const outcome = retryOutcome(result);
          if (outcome !== null) return outcome;
          break;
        }
        if (capture === null) return { retry: false };
        const beforeSearch = current.snapshot;
        current = { snapshot: capture.snapshot, sourceLocation: performed.action.destination, screenshotEvidenceId: capture.screenshotEvidenceId };
        item.evidenceId = capture.snapshot.evidenceId;
        if (selected.action === 'search') {
          searches = [...searches, {
            parameters: selected.parameters,
            controlSnapshot: beforeSearch,
            snapshot: current.snapshot,
            lookupKey: searchLookupKey(entry.target, record, selected.parameters, beforeSearch) ?? undefined,
          }];
        }
        if (selected.action === 'read-attribute') {
          const after = planAgentTools({ plan, target: entry.target, population: record, snapshot: current.snapshot, sourceLocation: current.sourceLocation, searches });
          if (after.found !== null) {
            const observation = buildFoundAgentObservation({
              plan, target: entry.target, population: record, workItemId: item.workItemId,
              stepExecutionId: execution.stepExecutionId, snapshot: current.snapshot,
              screenshotEvidenceId: current.screenshotEvidenceId,
              identityLocator: after.found.identityLocator,
              selections: after.found.selections,
              observedAt: nowIso(dependencies.clock),
            });
            const finished = await finishObservation(item, execution, observation, current.snapshot, 'OBSERVED');
            if (finished === 'lost') return { retry: checkpoint.status === 'RETRY' };
            if (finished === 'refused') {
              const result = await persistRetry(item, execution, 'observation-registration-refused');
              const outcome = retryOutcome(result);
              if (outcome !== null) return outcome;
            }
            break;
          }
        }
        actionsConsumed += 1;
        // A response is consumed one action at a time. Replanning on the refreshed page
        // is mandatory; any stale second proposal is rejected by the new tool id map.
        if (response.actions.length > 1 && actionsConsumed < response.actions.length) continue;
      }
      if (!isTerminalWorkItem(item)) {
        const result = await persistRetry(item, execution, 'insufficient-evidence');
        const outcome = retryOutcome(result);
        if (outcome !== null) return outcome;
      }
    }

    const completed = await dependencies.repository.transaction(run.runId, async (context) => {
      if (context.checkpoint?.revision !== checkpoint.revision || context.checkpoint.status !== 'EXECUTING' || context.run?.state !== 'RUNNING') return false;
      if (await stopAtFinalLimit(context)) return true;
      const pending = context.workItems.some((item) => !isTerminalWorkItem(item));
      if (pending) return false;
      const next: AgentWorkCheckpoint = { ...checkpoint, status: 'COMPLETE', workItemId: null, pendingWait: null, waitId: null, diagnostic: null };
      await context.saveCheckpoint(next, 'RUNNING');
      await appendEvent(context, run, 'agent-work-complete', 'RUNNING', next, {
        observations: context.workItems.reduce((total, item) => total + item.observations, 0),
      });
      if (await stopAtFinalLimit(context)) return true;
      await runRunLevelGate(context, { run, plan, decidedAt: nowIso(dependencies.clock) });
      return true;
    });
    return { retry: !completed };
  } catch (error) {
    const diagnostic = now() >= runDeadline ? 'run-time-limit' : failureDiagnostic(error);
    if (diagnostic === 'run-time-limit') {
      await stopRun('run-time-limit', 'run-time-limit');
      return { retry: false };
    }
    await stopRun(diagnostic, 'session-step-failed');
    return { retry: false };
  }
}
