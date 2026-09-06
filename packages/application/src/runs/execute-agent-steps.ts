import {
  authorizeToolAction,
  captureStateFor,
  exhaustedRunLimit,
  isToolActionMethod,
  runStopFor,
  sanitizeDestination,
  sessionStepAttemptBudget,
  workspaceRequirement,
  type ClassifiedTarget,
  type ExecutablePlan,
  type RunLimitCause,
  type RunRecord,
  type SanitizedToolAction,
  type ToolActionDenial,
  type ToolActionParameter,
  type ToolActionRequest,
  type ToolActionScope,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import {
  BrowserActionError,
  type AgentExecutionCheckpoint,
  type AgentExecutionContext,
  type AgentExecutionRepository,
  type BrowserActionFailureCode,
  type BrowserExecution,
  type BrowserCaptureKind,
  type CredentialResolver,
  type ResolvedCredential,
  type SessionStepRecord,
  type StepExecutionRecord,
  type WorkspaceRef,
} from './execution-ports.js';
import type { PopulationJob } from './acquire-population.js';
import { guardedCredentials, type CredentialGuard } from './credential-guard.js';
import { completeRun } from './complete-run.js';
import { performCancellation } from './cancel-run.js';
import { SECURITY_DENIED_EVENT } from './run-gate.js';

/**
 * The agent execution phase: sign in to every agent-driven Target System, and let nothing
 * happen that the Procedure Version did not freeze (Story 4.2, FR-3, AD-4, AD-9).
 *
 * It runs AFTER population acquisition and BEFORE any Work Item, which is the order the
 * compiler froze — `create-workspace`, `acquire-population`, then one `sign-in` per
 * agent-driven Target in authored order. A Run with no agent-driven Target reaches nothing
 * here and is unchanged by this story.
 *
 * The claim / lease / revision-recheck / save + event + notifyTimeline discipline is
 * `acquirePopulation`'s and `executeAdapterSteps`', deliberately copied in shape. Browser
 * I/O happens strictly BETWEEN transactions.
 *
 * **The gate is here, at the port's call site, and not in the provider adapter.** A
 * provider that enforced its own allowlist would make the guarantee a property of that
 * adapter, and the whole point of `BrowserExecution` is that the provider can be replaced.
 * `performToolAction` below is the ONLY way an action reaches the port, and it calls
 * `authorizeToolAction` first, records what it did in the shared sanitized log whichever
 * way the answer went, and returns a denial as a denial rather than as an outage.
 *
 * **Nothing here can carry a credential.** The reference comes from the frozen plan's
 * `credentialReferences`, the resolver answers with a `ResolvedCredential` that has no
 * field holding a value, and the audit chain refuses a credential-shaped payload key
 * outright — so the retrieval is recorded by naming the TARGET SYSTEM, never the
 * reference. `FORBIDDEN_PAYLOAD_KEYS` in `audit-event.ts` is what makes that a rule rather
 * than a habit.
 *
 * **What this story does NOT do**: capture, register Observations, prove absence or raise
 * Escalations (Stories 4.4 to 4.7). So a Run whose sign-ins succeed goes on to the adapter
 * stage, which still refuses a plan naming an agent-driven Target BY NAME and ends the Run
 * `RUN_FAILED`. The sign-in is durably recorded before that happens, which is the point:
 * the Session Step is proved by the session being ESTABLISHED.
 */

export interface AgentExecutionDependencies {
  repository: AgentExecutionRepository;
  browser: BrowserExecution;
  credentials: CredentialResolver;
  clock: Clock;
  ids: UuidV7Generator;
}

/** The closed diagnostic vocabulary. Never an error message, never a URL, never a value. */
export type AgentExecutionDiagnostic =
  | 'unsupported-frozen-plan'
  | 'workspace-missing'
  | 'agent-execution-started'
  | 'sign-in-attempt-started'
  | 'session-established'
  | 'agent-sign-in-complete'
  | 'run-time-limit'
  | 'run-step-execution-limit'
  | 'run-token-limit'
  | 'attempt-limit'
  | 'credential-unresolved'
  /** A desktop Target System: a browser workspace cannot drive one (LedgerDesk, deferred). */
  | 'desktop-unsupported'
  | 'sign-in-unavailable'
  | 'sign-in-contract-failed'
  /** The Target System refused. A denial, never an outage. */
  | 'sign-in-denied'
  /** The action left, or was sent, outside the frozen origins. */
  | 'sign-in-scope-violation'
  /** The gate refused the action before it left. The denial says which rule. */
  | 'action-not-permitted'
  | 'destination-refused'
  | 'origin-not-allowed'
  | 'parameter-out-of-scope'
  /** A person cancelled the Run. Never produced by a limit, a Gate or a failure. */
  | 'canceled';

const AGENT_EVENT = 'lifecycle.agent-execution';

/** The frozen action of the Session Step this stage executes. */
const SIGN_IN_ACTION = 'sign-in';

/** The Tool Action a sign-in takes: navigate to the frozen origin, carrying the credential. */
const SIGN_IN_TOOL_ACTION = 'navigate';

/**
 * The method every Tool Action STARTS with.
 *
 * What it ends on is read back from the workspace: a sign-in navigates with this and then
 * submits the Target System's own form, which is a `POST`. This is what a denied or failed
 * action records, because nothing reached the wire and the method the platform was about
 * to use is the only true thing there is to say.
 */
const READ_METHOD = 'GET';

/**
 * The scope an action with NO parameters is judged against.
 *
 * An empty set denies every parameter, which is the fail-closed reading and the right one:
 * a stage that has not put the frozen population in front of the gate has not proved a
 * value is inside it. Story 4.2 takes one parameterless action; the first parameterised
 * one belongs to the story that searches (4.5), and it supplies the population's own
 * values rather than widening this.
 */
const NO_PARAMETERS: ReadonlySet<string> = new Set<string>();
const NO_ARGUMENTS: readonly ToolActionParameter[] = [];

/**
 * What a Tool Action captures in this build: nothing.
 *
 * Written out rather than defaulted, so the day capture arrives (Story 4.4) the caller has
 * to name what it wants rather than inherit whatever the port decided. A credential-entry
 * action does not even have this field.
 */
const NO_CAPTURE: readonly BrowserCaptureKind[] = [];

/**
 * How a GATE denial is recorded, exhaustive by type.
 *
 * A `Record<ToolActionDenial, …>` rather than a cast: the four spellings happen to match
 * the diagnostic vocabulary today, and a fifth denial added to the domain must not compile
 * into a diagnostic that says something else.
 */
const DENIAL_DIAGNOSTIC: Readonly<Record<ToolActionDenial, AgentExecutionDiagnostic>> = {
  'action-not-permitted': 'action-not-permitted',
  'destination-refused': 'destination-refused',
  'origin-not-allowed': 'origin-not-allowed',
  'parameter-out-of-scope': 'parameter-out-of-scope',
};

/** How a browser failure code is recorded, exhaustive by type. */
const ACTION_FAILURE: Readonly<Record<BrowserActionFailureCode, AgentExecutionDiagnostic>> = {
  unavailable: 'sign-in-unavailable',
  denied: 'sign-in-denied',
  scope: 'sign-in-scope-violation',
  contract: 'sign-in-contract-failed',
};

/** The diagnostic each Run-level LIMIT is recorded under. */
const LIMIT_DIAGNOSTIC: Readonly<Record<RunLimitCause, AgentExecutionDiagnostic>> = {
  'run-step-execution-limit': 'run-step-execution-limit',
  'run-time-limit': 'run-time-limit',
  'run-token-limit': 'run-token-limit',
};

/**
 * The §E.1 cause behind a diagnostic, or `null` when it is not one this stage stops for.
 *
 * A denial and a scope violation are TERMINAL for the Run and carry a security event; a
 * transport failure is neither. Epic 3 folded a 403 into `!response.ok` and paid for it —
 * three retries against a system that would go on refusing, with a transport count as the
 * only durable record that the platform had been told no.
 */
export function agentStopCauseFor(
  diagnostic: AgentExecutionDiagnostic,
): 'action-denied' | 'scope-violation' | RunLimitCause | null {
  switch (diagnostic) {
    case 'sign-in-denied':
    case 'action-not-permitted':
    case 'parameter-out-of-scope':
      return 'action-denied';
    case 'sign-in-scope-violation':
    case 'origin-not-allowed':
    case 'destination-refused':
      return 'scope-violation';
    case 'run-time-limit':
      return 'run-time-limit';
    case 'run-step-execution-limit':
      return 'run-step-execution-limit';
    case 'run-token-limit':
      return 'run-token-limit';
    default:
      return null;
  }
}

interface EventFields {
  readonly stepId?: string;
  readonly stepExecutionId?: string;
  readonly registrationId?: string;
  readonly toolActionId?: string;
  readonly destination?: string;
  readonly action?: string;
  readonly parameter?: string;
  readonly status?: number;
  readonly attempt?: number;
  readonly workspaceId?: string;
}

function fieldsOf(fields: EventFields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

async function event(
  context: AgentExecutionContext,
  diagnostic: AgentExecutionDiagnostic,
  state: RunRecord['state'],
  checkpoint: AgentExecutionCheckpoint,
  fields: EventFields = {},
  outcome: 'success' | 'failure' = 'success',
): Promise<void> {
  const run = context.run!;
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
      attempts: checkpoint.attempts,
      attemptId: checkpoint.attemptId,
      ...fieldsOf(fields),
    },
  });
  await context.notifyTimeline(stored.sequence);
}

/**
 * Perform ONE Tool Action, or refuse it, and record what happened either way.
 *
 * The ONE path from this stage to the workspace. Exported because a test drives the
 * parameterised branch this story's own sign-in does not reach — Story 4.5 is the first
 * production caller that searches — and a branch nothing exercises is a branch that can be
 * inverted silently.
 *
 * `record` is called INSIDE the caller's transaction with the sanitized row, so the action
 * log and the state it produced commit together. The credential is passed straight to the
 * port and is never held here.
 */
export async function performToolAction(
  browser: BrowserExecution,
  input: {
    readonly ref: WorkspaceRef;
    readonly runId: string;
    readonly stepExecutionId: string;
    readonly workItemId: string | null;
    readonly toolActionId: string;
    readonly scope: ToolActionScope;
    readonly request: ToolActionRequest;
    readonly credential: ResolvedCredential | null;
    readonly startedAt: string;
    readonly completedAt: () => string;
    readonly timeoutMs: () => number;
    /**
     * Every credential this stage has presented (Story 4.3).
     *
     * Required, so no call site can record a destination without deciding what it is
     * scanning for. A destination is written into the immutable audit chain, and
     * `sanitizeDestination` strips the query and `user:pass@` but keeps the PATH — so a
     * system that put a token in a path segment, or a redirect that did, would otherwise
     * put it there permanently. The strip and the redaction are the same doctrine one step
     * apart: a destination denied FOR carrying a credential must still be recorded, and
     * recorded without it.
     */
    readonly guard: CredentialGuard;
  },
): Promise<
  | { readonly ok: true; readonly action: SanitizedToolAction; readonly status: number | null; readonly session: boolean }
  | { readonly ok: false; readonly action: SanitizedToolAction; readonly diagnostic: AgentExecutionDiagnostic }
> {
  // The platform's OWN knowledge of its own request, taken before the port is reached: an
  // action that presents a credential is a credential-entry action, its capture is
  // suppressed, and the row says so rather than leaving a reader to infer it from an
  // artifact that is not there. The `BrowserToolAction` union makes asking for capture on
  // such an action not compile; this is what records that it was suppressed.
  const { capture, suppression } = captureStateFor(input.credential !== null);
  const base = {
    toolActionId: input.toolActionId,
    runId: input.runId,
    stepExecutionId: input.stepExecutionId,
    workItemId: input.workItemId,
    surface: 'agent' as const,
    targetSystem: input.scope.target.registrationId,
    action: input.request.action,
    method: READ_METHOD,
    destination: input.guard.redact(sanitizeDestination(input.request.destination)),
    parameters: input.request.parameters,
    startedAt: input.startedAt,
    redirected: false,
    downloads: 0,
    capture,
    captureSuppression: suppression,
  };

  // The gate, BEFORE the port. Nothing below this line can be reached by an action the
  // frozen version does not permit, and a denial is recorded whether or not anything
  // afterwards succeeds.
  const decision = authorizeToolAction(input.scope, input.request);
  if (!decision.allowed) {
    return {
      ok: false,
      diagnostic: DENIAL_DIAGNOSTIC[decision.denial],
      action: {
        ...base,
        outcome: 'denied',
        denial: decision.denial,
        offending: decision.offending,
        status: null,
        completedAt: input.completedAt(),
        diagnostic: decision.denial,
      },
    };
  }

  try {
    const result = await browser.perform(
      input.ref,
      // The union is the suppression. An action carrying a credential has no `capture`
      // field to fill, so a Structural Snapshot, a screenshot or a frame cannot be asked
      // for while a credential is on the wire — it does not compile. An action carrying
      // none says what it captures, and today that is nothing: Story 4.4 is what captures.
      input.credential === null
        ? {
            action: decision.action,
            destination: decision.destination,
            credential: null,
            capture: NO_CAPTURE,
          }
        : {
            action: decision.action,
            destination: decision.destination,
            credential: input.credential,
          },
      input.timeoutMs(),
    );
    // The immutable action log records what happened, and a method this build cannot have
    // produced is a result it does not understand — recorded as a contract failure rather
    // than written into a row whose CHECK would refuse it and take the transaction with it.
    if (!isToolActionMethod(result.method)) {
      return {
        ok: false,
        diagnostic: ACTION_FAILURE.contract,
        action: {
          ...base,
          outcome: 'failed',
          denial: null,
          offending: null,
          status: null,
          completedAt: input.completedAt(),
          diagnostic: ACTION_FAILURE.contract,
        },
      };
    }
    return {
      ok: true,
      status: result.status,
      session: result.session,
      action: {
        ...base,
        // What the workspace actually put on the wire, before any redirect the SYSTEM
        // chose. A sign-in's is `POST`; a plain navigation's is the `GET` it started with.
        method: result.method,
        // What the workspace ENDED on, which is not always what it was sent to: a
        // same-origin redirect is followed and a cross-origin one is aborted by the
        // egress interception, and the difference has to be visible in the log. Redacted
        // for the same reason the requested destination is: this one is chosen by the
        // Target System rather than by the platform, so it is the likelier of the two to
        // carry something the platform never put there.
        destination: input.guard.redact(result.location),
        redirected: result.redirected,
        downloads: result.downloads,
        outcome: 'performed',
        denial: null,
        offending: null,
        status: result.status,
        completedAt: input.completedAt(),
        diagnostic: null,
      },
    };
  } catch (error) {
    const code = error instanceof BrowserActionError ? error.code : 'unavailable';
    const diagnostic = Object.hasOwn(ACTION_FAILURE, code)
      ? ACTION_FAILURE[code]
      : 'sign-in-unavailable';
    return {
      ok: false,
      diagnostic,
      action: {
        ...base,
        outcome: 'failed',
        denial: null,
        offending: null,
        status: null,
        completedAt: input.completedAt(),
        diagnostic,
      },
    };
  }
}

/**
 * Sign in to every agent-driven Target System the frozen plan names.
 *
 * `proceed` says whether the Run may continue to the next stage. It is `false` for a Run
 * this stage is still working on, and that matters: a transient sign-in failure writes a
 * `RETRY` checkpoint for the agent phase's own recovery sweep rather than asking the QUEUE
 * for a redelivery, because a redelivery re-verifies the population Evidence and spends
 * one of that stage's four durable attempts (the Story 3.3 rule, one phase along).
 */
export async function executeAgentSteps(
  dependencies: AgentExecutionDependencies,
  job: PopulationJob,
): Promise<{ retry: boolean; proceed: boolean }> {
  // Every credential this stage resolves is held by `guard`, because the stage resolves
  // through the WRAPPED resolver and never through the one it was handed (Story 4.3).
  // `performToolAction` takes it as a required argument, so no destination this stage
  // records can carry a credential the Run has presented.
  const { credentials, guard } = guardedCredentials(dependencies.credentials);
  const deps: AgentExecutionDependencies = { ...dependencies, credentials };
  const claim = await deps.repository.transaction(job.runId, async (context) => {
    const run = context.run;
    if (!run || run.correlationId !== job.correlationId || job.schemaVersion !== 1) return null;
    if (run.state !== 'RUNNING') return null;
    if (!context.populationReady) return null;
    const prior = context.checkpoint;
    if (prior?.status === 'TERMINAL') return null;
    const now = deps.clock.now();
    if (prior?.status === 'EXECUTING' && Date.parse(prior.leaseUntil) > now.getTime()) return null;

    const plan = await context.frozenPlan();
    const requirement = plan === null ? null : workspaceRequirement(plan);
    // A person asked for this Run to stop (Story 3.10), checked at the phase's first
    // boundary, before anything is claimed and before any browser action starts.
    if (run.cancellation !== null) {
      await performCancellation(context, {
        run,
        request: run.cancellation,
        at: now.toISOString(),
        plan: plan ?? null,
        source: 'worker',
      });
      return null;
    }
    // No agent-driven Target: no `sign-in` step, nothing to do, and no row written. An
    // adapter-only Run must be unchanged by this story, so it PROCEEDS rather than stops.
    if (plan === null || requirement === null) return { proceed: true } as const;
    // Already signed in. The phase is idempotent by its checkpoint: a redelivery after a
    // successful sign-in reattaches to the workspace and carries on rather than signing in
    // again, which is AD-16's whole point.
    if (prior?.status === 'SIGNED_IN') return { proceed: true } as const;

    const checkpoint: AgentExecutionCheckpoint = {
      revision: (prior?.revision ?? 0) + 1,
      status: 'EXECUTING',
      attempts: Math.min(sessionStepAttemptBudget(plan.limits), (prior?.attempts ?? 0) + 1),
      // The Run deadline starts with the FIRST population claim and is never restarted, so
      // this phase inherits it rather than starting a second clock.
      runStartedAt: prior?.runStartedAt ?? context.populationStartedAt ?? now.toISOString(),
      startedAt: prior?.startedAt ?? now.toISOString(),
      attemptStartedAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + plan.limits.stepTimeoutSeconds * 1000).toISOString(),
      attemptId: deps.ids.next(),
      diagnostic: null,
    };
    const budget = sessionStepAttemptBudget(plan.limits);
    const failed: AgentExecutionDiagnostic | null =
      requirement.unsupported !== null
        ? 'unsupported-frozen-plan'
        : // A workspace is a precondition of every action this phase takes. It is
          // provisioned by the stage before this one, whose failure already ends the Run,
          // so an absent row here is a defect rather than a state — and it fails closed.
          context.workspace === null
          ? 'workspace-missing'
          : now.getTime() - Date.parse(checkpoint.runStartedAt) >= plan.limits.runTimeoutSeconds * 1000
            ? 'run-time-limit'
            : (prior?.attempts ?? 0) >= budget
              ? 'attempt-limit'
              : null;
    if (failed !== null) {
      const state: RunRecord['state'] = failed === 'run-time-limit' ? 'INCONCLUSIVE' : 'RUN_FAILED';
      checkpoint.status = 'TERMINAL';
      checkpoint.diagnostic = failed;
      await context.saveCheckpoint(checkpoint, state);
      await event(context, failed, state, checkpoint, {}, 'failure');
      await completeRun(context, { run, state, at: now.toISOString(), plan });
      return null;
    }

    // Materialize one Session Step per agent-driven Target on the first claim, and reuse
    // the persisted rows after. The FROZEN `sign-in` step id is the identity, so a resumed
    // Run finds its own rows rather than making new ones.
    const steps: SessionStepRecord[] = requirement.agentTargets.map((entry) => {
      const existing = context.sessionSteps.find((row) => row.stepId === entry.stepId);
      return (
        existing ?? {
          stepId: entry.stepId,
          ordinal: entry.ordinal,
          registrationId: entry.target.registrationId,
          displayName: entry.target.displayName,
          action: 'sign-in' as const,
          state: 'PENDING' as const,
          attempts: 0,
          diagnostic: null,
          evidenceId: null,
        }
      );
    });
    await context.saveCheckpoint(checkpoint, 'RUNNING');
    for (const step of steps) await context.saveSessionStep(step);
    await event(context, 'agent-execution-started', 'RUNNING', checkpoint, {
      workspaceId: context.workspace!.workspaceId,
    });
    return {
      proceed: false as const,
      checkpoint,
      plan,
      run,
      steps,
      targets: requirement.agentTargets,
      ref: {
        runId: run.runId,
        workspaceId: context.workspace!.workspaceId,
        mode: context.workspace!.mode,
      } as WorkspaceRef,
      stepExecutions: await context.readStepExecutionCount(),
    };
  });
  if (claim === null) return { retry: false, proceed: false };
  if (claim.proceed) return { retry: false, proceed: true };

  const { checkpoint, plan, run, steps, targets, ref } = claim;
  const runDeadline = Date.parse(checkpoint.runStartedAt) + plan.limits.runTimeoutSeconds * 1000;
  const stepTimeoutMs = plan.limits.stepTimeoutSeconds * 1000;
  let stepExecutions = claim.stepExecutions;

  const now = (): number => deps.clock.now().getTime();
  const limitReached = (): RunLimitCause | null =>
    exhaustedRunLimit(
      { stepExecutions, elapsedMs: now() - Date.parse(checkpoint.runStartedAt), tokens: 0 },
      plan.limits,
    );
  /** Bounded by the shorter of the lease, the frozen Step timeout and the Run deadline. */
  const budget = (): number => {
    const ms = Math.min(Date.parse(checkpoint.leaseUntil), runDeadline, now() + stepTimeoutMs) - now();
    if (ms <= 0) throw new BrowserActionError('unavailable');
    return ms;
  };

  /** Guarded commit. A lost claim writes nothing; the returned flag says which happened. */
  const guarded = async (
    work: (context: AgentExecutionContext) => Promise<void>,
  ): Promise<boolean> =>
    deps.repository.transaction(run.runId, async (context) => {
      if (
        context.checkpoint?.revision !== checkpoint.revision ||
        context.checkpoint.status !== 'EXECUTING' ||
        context.run?.state !== 'RUNNING'
      )
        return false;
      await work(context);
      return true;
    });

  const stopRun = async (
    diagnostic: AgentExecutionDiagnostic,
    state: RunRecord['state'],
    fields: EventFields,
  ): Promise<void> => {
    await guarded(async (context) => {
      const next = { ...checkpoint, status: 'TERMINAL' as const, diagnostic };
      await context.saveCheckpoint(next, state);
      await event(context, diagnostic, state, next, fields, 'failure');
      // §E.1: a denied action or a scope violation is ADDITIONALLY logged as a security
      // event. Appended here rather than remembered at each call site, so a branch that
      // stops the Run cannot drop the only record that the platform was told no.
      const cause = agentStopCauseFor(diagnostic);
      if (cause !== null && runStopFor(cause).securityEvent) {
        const stored = await context.auditEvents.append({
          actor: { type: 'system', id: 'agent-worker' },
          eventType: SECURITY_DENIED_EVENT,
          source: 'worker',
          outcome: 'denied',
          aggregateId: run.runId,
          correlationId: run.correlationId,
          sessionId: run.sessionId,
          payload: { cause, diagnostic, state, ...fieldsOf(fields) },
        });
        await context.notifyTimeline(stored.sequence);
      }
      await completeRun(context, { run, state, at: deps.clock.now().toISOString(), plan });
    });
  };

  /** Honour a cancellation at a Session Step boundary, never inside one (Story 3.10). */
  const canceledAtBoundary = async (): Promise<boolean> => {
    let canceled = false;
    await guarded(async (context) => {
      const request = context.run?.cancellation ?? null;
      if (request === null) return;
      canceled = true;
      const next = { ...checkpoint, status: 'TERMINAL' as const, diagnostic: 'canceled' as const };
      await context.saveCheckpoint(next, 'CANCELED');
      await event(context, 'canceled', 'CANCELED', next, {}, 'failure');
      await performCancellation(context, {
        run,
        request,
        at: deps.clock.now().toISOString(),
        plan,
        source: 'worker',
      });
    });
    return canceled;
  };

  const startStepExecution = (planStepId: string, attempt: number): StepExecutionRecord => ({
    // Counted here, where a Step Execution actually starts, so no branch can start one
    // without spending the frozen limit for it.
    stepExecutionId: (stepExecutions += 1, deps.ids.next()),
    planStepId,
    workItemId: null,
    action: SIGN_IN_ACTION,
    state: 'RUNNING',
    attempt,
    startedAt: deps.clock.now().toISOString(),
    completedAt: null,
    diagnostic: null,
  });

  try {
  for (const entry of targets) {
    const step = steps.find((row) => row.stepId === entry.stepId)!;
    if (step.state === 'ACQUIRED') continue;
    if (await canceledAtBoundary()) return { retry: false, proceed: false };
    if (step.state === 'FAILED') {
      await stopRun(
        (step.diagnostic ?? 'sign-in-unavailable') as AgentExecutionDiagnostic,
        'RUN_FAILED',
        { stepId: step.stepId, registrationId: step.registrationId },
      );
      return { retry: false, proceed: false };
    }
    const spent = limitReached();
    if (spent !== null) {
      const decision = runStopFor(spent);
      await stopRun(LIMIT_DIAGNOSTIC[spent], decision.state, { stepId: step.stepId });
      return { retry: false, proceed: false };
    }
    const outcome = await runSignInStep(deps, {
      checkpoint,
      plan,
      entry,
      step,
      ref,
      guarded,
      budget,
      limitReached,
      startStepExecution,
      guard,
    });
    if (outcome === 'lost') return { retry: false, proceed: false };
    if (outcome === 'limit') {
      const spentNow = limitReached() ?? 'run-time-limit';
      await stopRun(LIMIT_DIAGNOSTIC[spentNow], runStopFor(spentNow).state, {
        stepId: step.stepId,
      });
      return { retry: false, proceed: false };
    }
    if (outcome === 'failed') {
      // §E: a Run-level Session Step failing after bounded retries is `RUN_FAILED`, and
      // `stopRun` adds the security event when the reason was a denial rather than an outage.
      await stopRun(step.diagnostic as AgentExecutionDiagnostic, 'RUN_FAILED', {
        stepId: step.stepId,
        registrationId: step.registrationId,
      });
      return { retry: false, proceed: false };
    }
  }

  const committed = await guarded(async (context) => {
    const next = { ...checkpoint, status: 'SIGNED_IN' as const, diagnostic: null };
    await context.saveCheckpoint(next, 'RUNNING');
    await event(context, 'agent-sign-in-complete', 'RUNNING', next, {});
  });
  return { retry: false, proceed: committed };
  } catch {
    // Nothing above is expected to throw — every browser failure is caught and recorded as
    // a Tool Action — so this is the case where the DATABASE did. It writes `RETRY` rather
    // than letting the throw reach the queue: a redelivery re-verifies the population
    // Evidence and spends one of that stage's four durable attempts, so a database hiccup
    // here would cost a Run the budget of a stage that had already finished. The phase's
    // own sweep resumes it on the next tick instead of waiting out the lease.
    await deps.repository
      .transaction(run.runId, async (context) => {
        if (context.checkpoint?.revision !== checkpoint.revision) return;
        await context.saveCheckpoint({ ...checkpoint, status: 'RETRY', diagnostic: null }, 'RUNNING');
      })
      .catch(() => undefined);
    return { retry: false, proceed: false };
  }
}

interface SignInUnit {
  checkpoint: AgentExecutionCheckpoint;
  plan: ExecutablePlan;
  entry: ClassifiedTarget;
  step: SessionStepRecord;
  ref: WorkspaceRef;
  /** Every credential this stage has presented, for the recorded destinations. */
  guard: CredentialGuard;
  guarded(work: (context: AgentExecutionContext) => Promise<void>): Promise<boolean>;
  budget(): number;
  limitReached(): RunLimitCause | null;
  startStepExecution(planStepId: string, attempt: number): StepExecutionRecord;
}

/**
 * One agent-driven Target System's sign-in Session Step.
 *
 * ONE bounded cycle, exactly as a Reference Source acquisition has: §E maps a Run-level
 * Session Step's failure after bounded retries to `RUN_FAILED`, so the owner's automatic
 * second cycle — which exists to let a Run CONTINUE past a failed unit — has nothing to
 * buy here.
 *
 * The step is proved by the SESSION being established, and by nothing else. There is no
 * form to submit: every synthetic Northstar system refuses a POST at the system level, so
 * LoanCore authenticates a GET carrying the credential in a header and answers a session
 * cookie the workspace then holds.
 */
async function runSignInStep(
  deps: AgentExecutionDependencies,
  unit: SignInUnit,
): Promise<'acquired' | 'failed' | 'lost' | 'limit'> {
  const { step, entry, checkpoint, plan } = unit;
  const budgetAttempts = sessionStepAttemptBudget(plan.limits);
  const contract = entry.target.contract;
  const scope: ToolActionScope = { target: entry.target, scopeValues: NO_PARAMETERS };

  while (step.attempts < budgetAttempts) {
    if (unit.limitReached() !== null) return 'limit';
    step.attempts += 1;
    const execution = unit.startStepExecution(entry.stepId, step.attempts);
    step.state = 'IN_PROGRESS';
    step.diagnostic = null;
    const reserved = await unit.guarded(async (context) => {
      await context.saveCheckpoint(checkpoint, 'RUNNING');
      await context.saveSessionStep(step);
      await context.saveStepExecution(execution);
      await event(context, 'sign-in-attempt-started', 'RUNNING', checkpoint, {
        stepId: step.stepId,
        registrationId: step.registrationId,
        stepExecutionId: execution.stepExecutionId,
        attempt: step.attempts,
      });
    });
    if (!reserved) return 'lost';

    const fail = async (
      diagnostic: AgentExecutionDiagnostic,
      action: SanitizedToolAction | null,
      terminal: boolean,
    ): Promise<'failed' | 'retry' | 'lost'> => {
      const exhausted = terminal || step.attempts >= budgetAttempts;
      step.state = exhausted ? 'FAILED' : 'PENDING';
      step.diagnostic = diagnostic;
      const committed = await unit.guarded(async (context) => {
        if (action !== null) await context.saveToolAction(action);
        await context.saveSessionStep(step);
        await context.saveStepExecution({
          ...execution,
          state: 'FAILED',
          completedAt: deps.clock.now().toISOString(),
          diagnostic,
        });
        await event(
          context,
          diagnostic,
          'RUNNING',
          checkpoint,
          {
            stepId: step.stepId,
            registrationId: step.registrationId,
            stepExecutionId: execution.stepExecutionId,
            attempt: step.attempts,
            ...(action === null
              ? {}
              : {
                  toolActionId: action.toolActionId,
                  destination: action.destination,
                  action: action.action,
                  ...(action.offending === null || action.denial !== 'parameter-out-of-scope'
                    ? {}
                    : { parameter: action.offending }),
                }),
          },
          'failure',
        );
      });
      if (!committed) return 'lost';
      return exhausted ? 'failed' : 'retry';
    };

    // A `desktop` registration's application identity occupies the `allowed_origins` slot
    // of the six-key envelope and is not a URL. A browser workspace cannot drive one, and
    // saying so by name is better than letting the gate refuse a destination that was
    // never a destination. LedgerDesk is deferred; this is where it arrives.
    if (contract.kind !== 'web') {
      const outcome = await fail('desktop-unsupported', null, true);
      if (outcome !== 'retry') return outcome;
      continue;
    }

    // The credential reference comes from the FROZEN plan, never from a current
    // registration. An unresolvable reference is TERMINAL on the first attempt: retrying a
    // reference nobody declared against a live system proves nothing (Story 3.3's rule).
    const reference = plan.credentialReferences.find(
      (candidate) => candidate.targetSystemId === entry.target.registrationId,
    );
    let credential: ResolvedCredential;
    try {
      if (reference === undefined || reference.credentialRef !== contract.credential_ref) {
        throw new BrowserActionError('contract');
      }
      credential = await deps.credentials.resolve(reference.credentialRef, unit.budget());
      // The resolver echoes the reference it was ASKED about, and it is compared here: a
      // service that batched, cached by a normalized key or resolved an alias could
      // otherwise answer about a different credential entirely.
      if (credential.reference !== reference.credentialRef) throw new BrowserActionError('contract');
    } catch (error) {
      // A spent lease is not an unresolvable credential. `unit.budget()` throws when the
      // lease, the frozen Step timeout or the Run deadline has run out, and reporting that
      // as `credential-unresolved` would name the wrong thing AND be terminal, because a
      // reference nobody declared is not worth retrying and a deadline is a different fact.
      const deadline = error instanceof BrowserActionError && error.code === 'unavailable';
      const outcome = await fail(
        deadline ? 'sign-in-unavailable' : 'credential-unresolved',
        null,
        !deadline,
      );
      if (outcome !== 'retry') return outcome;
      continue;
    }

    // The frozen origin IS the sign-in destination. It is not derived from a path this
    // code guessed and not read out of anything the system said: `allowed_origins` is a
    // normalized set, so "the first" is deterministic for one frozen contract — the same
    // rule `targetOrigin` applies on the adapter path.
    const destination = contract.allowed_origins[0] ?? '';
    const request: ToolActionRequest = {
      action: SIGN_IN_TOOL_ACTION,
      destination,
      parameters: NO_ARGUMENTS,
    };
    const startedAt = deps.clock.now().toISOString();
    const performed = await performToolAction(deps.browser, {
      ref: unit.ref,
      runId: unit.ref.runId,
      stepExecutionId: execution.stepExecutionId,
      workItemId: null,
      toolActionId: deps.ids.next(),
      scope,
      request,
      credential,
      startedAt,
      completedAt: () => deps.clock.now().toISOString(),
      timeoutMs: unit.budget,
      guard: unit.guard,
    });
    if (!performed.ok) {
      // A gate denial and a Target System refusal are both TERMINAL: the same frozen bytes
      // make the same decision every time, and a system that said no will go on saying it.
      const terminal = agentStopCauseFor(performed.diagnostic) !== null;
      const outcome = await fail(performed.diagnostic, performed.action, terminal);
      if (outcome !== 'retry') return outcome;
      continue;
    }
    // The step is proved by the SESSION being established: the credential resolved through
    // the port, a 200 where an unauthenticated GET answers 401, and a session the
    // workspace now holds. Never by "a form submitted", which there is not one of.
    if (!performed.session || performed.status === null || performed.status >= 300) {
      const outcome = await fail(
        performed.status === 401 || performed.status === 403 ? 'sign-in-denied' : 'sign-in-contract-failed',
        performed.action,
        performed.status === 401 || performed.status === 403,
      );
      if (outcome !== 'retry') return outcome;
      continue;
    }

    step.state = 'ACQUIRED';
    step.diagnostic = null;
    const committed = await unit.guarded(async (context) => {
      await context.saveToolAction(performed.action);
      await context.saveSessionStep(step);
      await context.saveStepExecution({
        ...execution,
        state: 'SUCCEEDED',
        completedAt: deps.clock.now().toISOString(),
      });
      await event(context, 'session-established', 'RUNNING', checkpoint, {
        stepId: step.stepId,
        registrationId: step.registrationId,
        stepExecutionId: execution.stepExecutionId,
        toolActionId: performed.action.toolActionId,
        destination: performed.action.destination,
        // The RETRIEVAL is audited by naming the Target System, never the credential
        // reference: `FORBIDDEN_PAYLOAD_KEYS` refuses `credentialRef` outright, and the
        // frozen plan's `credentialReferences` entry for this system already says which
        // reference was used.
        action: performed.action.action,
        ...(performed.status === null ? {} : { status: performed.status }),
        attempt: step.attempts,
      });
    });
    return committed ? 'acquired' : 'lost';
  }

  step.state = 'FAILED';
  step.diagnostic = step.diagnostic ?? 'sign-in-unavailable';
  // Reached only when a resumed step already holds a spent budget in a non-terminal state.
  // Persist what is being claimed rather than reporting it and writing nothing.
  await unit.guarded(async (context) => {
    await context.saveSessionStep(step);
  });
  return 'failed';
}
