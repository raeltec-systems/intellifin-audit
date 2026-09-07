import {
  runStopFor,
  sessionStepAttemptBudget,
  workspaceRequirement,
  type RunRecord,
} from '@intellifin/domain';
import type { Clock, UuidV7Generator } from '../audit/clock.js';
import {
  WorkspaceProvisionError,
  type BrowserExecution,
  type WorkspaceFailureCode,
  type WorkspaceCheckpoint,
  type WorkspaceDenial,
  type WorkspaceExecutionContext,
  type WorkspaceExecutionRepository,
  type WorkspaceHandle,
  type WorkspaceRef,
} from './execution-ports.js';
import type { PopulationJob } from './acquire-population.js';
import { completeRun } from './complete-run.js';
import { performCancellation } from './cancel-run.js';
import { SECURITY_DENIED_EVENT } from './run-gate.js';

/**
 * `ProvisionWorkspace` and `ReleaseWorkspace`: the isolated Agent Workspace one Run gets
 * (Story 4.1, AD-4, AD-16).
 *
 * The frozen plan decides whether a Run needs one at all — `workspaceRequirement` reads
 * `create-workspace`, which the compiler emits FIRST exactly when a selected Target is web
 * or desktop — so an adapter-only Run reaches nothing here and is unchanged by this story.
 *
 * The claim / lease / revision-recheck / save + event + notifyTimeline discipline is
 * `acquirePopulation`'s, deliberately copied in shape. Provider I/O happens strictly
 * BETWEEN transactions: a browser is created or released over a network, and a database
 * transaction held across that is a connection pinned to somebody else's latency.
 *
 * **This story provisions the workspace and nothing else.** Sign-in, credentials,
 * navigation, capture, Observations and Escalations are Stories 4.2 to 4.7, and
 * `classifyPlanTargets` still refuses an agent-driven Target BY NAME at the execution
 * stage. So an agent Run today creates its workspace, then meets that refusal — through
 * the population stage, whose first Session Step is not `acquire-population` — and ends
 * `RUN_FAILED` with its workspace released. **Story 4.2 takes over here**: it is what
 * signs in through this workspace, and what makes the plan executable past this point.
 *
 * Nothing in this file can carry a secret. `WorkspaceRef` holds a Run id, an opaque
 * provider session identifier and the mode; there is no field for an API key, a session
 * token or a wire-protocol endpoint, so no checkpoint, audit payload, Timeline event, log
 * field or error message here has anywhere to pick one up from.
 */

export interface WorkspaceDependencies {
  repository: WorkspaceExecutionRepository;
  browser: BrowserExecution;
  clock: Clock;
  ids: UuidV7Generator;
}

/**
 * The result of the workspace claim. The replacement marker is deliberately optional:
 * callers that only need to know whether the claim succeeded keep the original two-key
 * result, while recovery can distinguish a fresh browser identity from a live reattach.
 * It is present only after an already durable identity was released (or had expired) and
 * the replacement was committed to the Run.
 */
export interface ProvisionWorkspaceResult {
  readonly retry: boolean;
  readonly provisioned: boolean;
  readonly workspaceReplaced?: true;
}

/** The closed diagnostic vocabulary. Never an error message, never a URL, never a value. */
export type WorkspaceDiagnostic =
  | 'unsupported-frozen-plan'
  | 'workspace-created'
  | 'workspace-reattached'
  /** Reattach was impossible, so the stale identity was released and a new one made. */
  | 'workspace-reattach-failed'
  /**
   * Reattach was impossible AND giving the stale identity back FAILED, so nothing was
   * replaced and the row still names the workspace this Run already holds.
   */
  | 'workspace-release-failed'
  | 'workspace-released'
  /** The provider's own hard deadline had passed, so the stored identity was gone. */
  | 'workspace-expired'
  | 'workspace-unavailable'
  | 'workspace-capacity'
  | 'workspace-entitlement'
  | 'workspace-refused'
  | 'workspace-policy'
  | 'attempt-limit'
  | 'canceled';

/** The Timeline event every workspace transition appends. */
const WORKSPACE_EVENT = 'lifecycle.agent-workspace';

/** The frozen `create-workspace` Session Step this stage executes. */
const WORKSPACE_ACTION = 'create-workspace';

/**
 * How long a release may take.
 *
 * Not read from the plan: a release runs after the Run has ended, when the frozen Step
 * timeout no longer governs anything, and a Run whose plan cannot be read still has a
 * workspace to give back.
 */
export const WORKSPACE_RELEASE_TIMEOUT_MS = 30_000;

/**
 * The failure codes that will refuse identically on every attempt.
 *
 * A provider refusing on plan grounds, a provider refusing for a reason this build cannot
 * read, and a frozen allowlist this build cannot parse are decisions rather than outages:
 * retrying any of them four times against the same inputs proves nothing and spends the
 * Session Step budget doing it. The `credential-unresolved` rule from Story 3.3, one stage
 * along. An UNRECOGNISED provider code is terminal for the same reason it is unrecognised:
 * this build has no basis for calling it transient.
 */
const TERMINAL_CODES: Readonly<Record<WorkspaceFailureCode, boolean>> = {
  unavailable: false,
  capacity: false,
  entitlement: true,
  refused: true,
  policy: true,
};

function terminalCode(code: WorkspaceFailureCode): boolean {
  return Object.hasOwn(TERMINAL_CODES, code) ? TERMINAL_CODES[code] : true;
}

/** One diagnostic per failure code, exhaustive by type. */
const FAILURE_DIAGNOSTIC: Readonly<Record<WorkspaceFailureCode, WorkspaceDiagnostic>> = {
  unavailable: 'workspace-unavailable',
  capacity: 'workspace-capacity',
  entitlement: 'workspace-entitlement',
  refused: 'workspace-refused',
  policy: 'workspace-policy',
};

/**
 * The code, verbatim, or `unavailable` for a failure that is not a provision error at all.
 *
 * A code outside the union is NOT normalized away here: the two lookups below fail closed
 * on it, so a provider reason this build has never heard of is terminal and is recorded as
 * a refusal rather than quietly becoming a retryable outage.
 */
function failureCode(error: unknown): WorkspaceFailureCode {
  return error instanceof WorkspaceProvisionError ? error.code : 'unavailable';
}

function diagnosticOf(code: WorkspaceFailureCode): WorkspaceDiagnostic {
  return Object.hasOwn(FAILURE_DIAGNOSTIC, code) ? FAILURE_DIAGNOSTIC[code] : 'workspace-refused';
}

/**
 * Giving the STALE identity back failed, carried to the one failure handler below.
 *
 * Private, and it never leaves this module. It exists because that outcome is not a
 * `WorkspaceProvisionError` and must not be spelled as one: nothing was provisioned, and
 * the workspace this Run already holds is very possibly still alive at the provider. A
 * create-side diagnostic on a release-side failure would lose exactly the distinction that
 * decides whether a replacement may be made.
 *
 * It carries no `cause`. The provider's error is dropped rather than kept, because the
 * diagnostic vocabulary is closed and an error message is where a wire-protocol endpoint, a
 * URL or a value would ride into a checkpoint and an immutable event.
 */
class StaleReleaseFailed extends Error {
  override readonly name = 'StaleReleaseFailed';
}

interface EventFields {
  readonly stepId?: string;
  readonly workspaceId?: string;
  readonly mode?: string;
  readonly attempt?: number;
  /**
   * A RUNNING TOTAL for this workspace, not a count of the denials in this event.
   *
   * `denied()` never resets, so a second boundary reports every refusal the workspace has
   * had rather than the ones since the last one — and the field is named for that, because
   * a number that reads as a delta and is a total is a number somebody will add up. The
   * record of WHICH destinations were refused is the `security.action-denied` events, each
   * appended exactly once from a drained log.
   */
  readonly deniedTotal?: number;
}

async function event(
  context: WorkspaceExecutionContext,
  diagnostic: WorkspaceDiagnostic,
  state: RunRecord['state'],
  checkpoint: WorkspaceCheckpoint,
  fields: EventFields = {},
  outcome: 'success' | 'failure' = 'success',
): Promise<void> {
  const run = context.run!;
  const stored = await context.auditEvents.append({
    actor: { type: 'system', id: 'workspace-worker' },
    eventType: WORKSPACE_EVENT,
    source: 'worker',
    outcome,
    aggregateId: run.runId,
    correlationId: run.correlationId,
    sessionId: run.sessionId,
    payload: {
      state,
      diagnostic,
      attempts: checkpoint.attempts,
      stepId: checkpoint.stepId,
      mode: checkpoint.mode,
      // The provider session identifier, so a provider-side session is correlatable with
      // this Run. Opaque and not a capability — releasing a Solari session still needs the
      // deployment's API key — and the endpoint that WOULD be one is never recorded.
      ...(checkpoint.workspaceId === null ? {} : { workspaceId: checkpoint.workspaceId }),
      // The provider's hard deadline, so the chain says WHY a workspace was replaced.
      ...(checkpoint.expiresAt === null ? {} : { expiresAt: checkpoint.expiresAt }),
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    },
  });
  await context.notifyTimeline(stored.sequence);
}

/**
 * Record every destination the workspace was refused, as security events.
 *
 * §E.1 maps a denied action to a security event, and Epic 3 learned the cost of not doing
 * it: a refusal reported as a transport failure was retried three times against a system
 * that would go on refusing, and the only durable record that the platform had been told
 * no was a transport count. A denied destination here is `security.action-denied` with the
 * destination recorded and no credential anywhere near it.
 */
async function recordDenials(
  context: WorkspaceExecutionContext,
  denials: readonly WorkspaceDenial[],
): Promise<void> {
  const run = context.run!;
  for (const denial of denials) {
    const stored = await context.auditEvents.append({
      actor: { type: 'system', id: 'workspace-worker' },
      eventType: SECURITY_DENIED_EVENT,
      source: 'worker',
      outcome: 'denied',
      aggregateId: run.runId,
      correlationId: run.correlationId,
      sessionId: run.sessionId,
      payload: {
        cause: 'scope-violation',
        diagnostic: 'workspace-egress-denied',
        destination: denial.destination,
        method: denial.method,
        resourceType: denial.resourceType,
      },
    });
    await context.notifyTimeline(stored.sequence);
  }
}

/** The Run states in which a workspace is still bound to its Run. */
function runIsOver(state: RunRecord['state']): boolean {
  return !['QUEUED', 'RUNNING', 'PAUSED', 'AWAITING_AUDITOR'].includes(state);
}

/**
 * Provision the Run's Agent Workspace, or reattach to the one it already has.
 *
 * Returns `provisioned: false` for a Run that needs no workspace at all — an adapter-only
 * Run, which must be able to run exactly as it did before this story. `retry: true` asks
 * the queue to redeliver: the attempt failed for a reason that may not fail again, and the
 * Session Step budget has not been spent.
 */
export async function provisionWorkspace(
  deps: WorkspaceDependencies,
  job: PopulationJob,
): Promise<ProvisionWorkspaceResult> {
  const claim = await deps.repository.transaction(job.runId, async (context) => {
    const run = context.run;
    if (!run || run.correlationId !== job.correlationId || job.schemaVersion !== 1) return null;
    if (!['QUEUED', 'RUNNING'].includes(run.state)) return null;
    const prior = context.checkpoint;
    if (prior?.status === 'RELEASED' || prior?.status === 'FAILED') return null;
    const now = deps.clock.now();
    // Somebody else is provisioning this workspace right now.
    if (prior?.status === 'PROVISIONING' && Date.parse(prior.leaseUntil) > now.getTime()) return null;

    const plan = await context.frozenPlan();
    const requirement = plan === null ? null : workspaceRequirement(plan);
    // A person asked for this Run to stop (Story 3.10). This claim transaction is the
    // first boundary of the Run, checked before anything is provisioned. The workspace row
    // is left exactly as it is: releasing a browser is network I/O and cannot happen inside
    // this transaction, so the reaper — whose whole purpose is a workspace whose Run has
    // ended — is what takes it away.
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
    // No agent-driven Target: no `create-workspace` step, nothing to provision, and no row
    // written. An adapter-only Run must be unchanged by this story.
    if (requirement === null) return null;

    const budget = sessionStepAttemptBudget(plan?.limits ?? null);
    /**
     * A workspace that is already OPEN is being REATTACHED to, not provisioned.
     *
     * `attempts` bounds PROVISIONING failures, so a redelivered job for a healthy Run must
     * not spend it: `acquirePopulation` asks for a redelivery on any transient transport
     * failure and has four attempts of its own, so a Run that retried its population three
     * times would otherwise arrive here with the workspace budget already gone — and the
     * fifth redelivery would fail a Run whose workspace had been fine every single time.
     * An OPEN row therefore carries its count forward unchanged and is not subject to the
     * limit; a failure moves the row to RETRY, and the next claim does count.
     */
    const reattaching = prior?.status === 'OPEN';
    const checkpoint: WorkspaceCheckpoint = {
      revision: (prior?.revision ?? 0) + 1,
      status: 'PROVISIONING',
      attempts: reattaching ? prior.attempts : Math.min(budget, (prior?.attempts ?? 0) + 1),
      stepId: prior?.stepId ?? requirement.stepId,
      workspaceId: prior?.workspaceId ?? null,
      expiresAt: prior?.expiresAt ?? null,
      // Existing identity includes its provider; deployment configuration cannot relabel it.
      mode: prior?.workspaceId != null ? prior.mode : deps.browser.mode,
      startedAt: prior?.startedAt ?? now.toISOString(),
      attemptStartedAt: now.toISOString(),
      leaseUntil: new Date(
        now.getTime() + (plan?.limits.stepTimeoutSeconds ?? 120) * 1000,
      ).toISOString(),
      releasedAt: null,
      diagnostic: null,
    };
    const failed: WorkspaceDiagnostic | null =
      requirement.unsupported !== null
        ? 'unsupported-frozen-plan'
        : !reattaching && (prior?.attempts ?? 0) >= budget
          ? 'attempt-limit'
          : null;
    if (failed !== null) {
      // §E: a Run-level Session Step failing after bounded retries is `RUN_FAILED`, and
      // `runStopFor` is where that mapping lives rather than restated here.
      const { state } = runStopFor('session-step-failed');
      checkpoint.status = 'FAILED';
      checkpoint.diagnostic = failed;
      await context.save(checkpoint, state);
      await event(context, failed, state, checkpoint, {}, 'failure');
      await completeRun(context, { run, state, at: now.toISOString(), plan: plan ?? null });
      return null;
    }
    await context.save(checkpoint, 'RUNNING');
    return { checkpoint, run, plan: plan!, requirement, budget };
  });
  if (claim === null) return { retry: false, provisioned: false };

  const { checkpoint, run, plan, requirement, budget } = claim;
  const stepTimeoutMs = plan.limits.stepTimeoutSeconds * 1000;
  const startedAt = deps.clock.now().toISOString();
  const stepExecutionId = deps.ids.next();
  const remaining = (): number => {
    const ms = Date.parse(checkpoint.leaseUntil) - deps.clock.now().getTime();
    if (ms <= 0) throw new WorkspaceProvisionError('unavailable');
    return ms;
  };

  /** Guarded commit. A lost claim writes nothing; the returned flag says which happened. */
  const guarded = async (
    work: (context: WorkspaceExecutionContext) => Promise<void>,
  ): Promise<boolean> =>
    deps.repository.transaction(run.runId, async (context) => {
      if (
        context.checkpoint?.revision !== checkpoint.revision ||
        context.checkpoint.status !== 'PROVISIONING' ||
        context.run?.state !== 'RUNNING'
      )
        return false;
      await work(context);
      return true;
    });

  let handle: WorkspaceHandle | null = null;
  // Set only after a durable identity was found to be unavailable and its release path
  // completed. A failed release, failed create, or lost guarded commit must never tell the
  // caller that a replacement exists: in each case the durable row still names the old
  // identity (or no new identity at all).
  let workspaceReplaced = false;
  let diagnostic: WorkspaceDiagnostic = 'workspace-created';
  try {
    // Keep the cleanup reference intact when this worker cannot operate its provider.
    if (checkpoint.workspaceId !== null && checkpoint.mode !== deps.browser.mode) {
      throw new WorkspaceProvisionError('policy');
    }
    // Reattach FIRST, always, when an identity is already recorded: a resumed claim must
    // find the workspace it left rather than making a second one (AD-16). `attach`
    // answering `null` is expected rather than exceptional — a browser does not survive
    // the process that connected to it — and the stale identity is released BEFORE a
    // replacement is made, so "never a second workspace" holds across the failure too.
    //
    // A release that FAILS is therefore not a step to get past: it is the one case in
    // which a replacement must not be made at all.
    if (checkpoint.workspaceId !== null) {
      const ref: WorkspaceRef = {
        runId: run.runId,
        workspaceId: checkpoint.workspaceId,
        mode: checkpoint.mode,
      };
      // Solari's `expiresAt` is a plan-tier HARD deadline at which the session
      // auto-releases; nothing a Run does resets it. Past it the identity is GONE rather
      // than unhealthy, and the two must stay distinguishable in the durable record — an
      // expired workspace is a fact about the provider's plan, not an outage to chase.
      const expired =
        checkpoint.expiresAt !== null &&
        Date.parse(checkpoint.expiresAt) <= deps.clock.now().getTime();
      handle = expired ? null : await deps.browser.attach(ref);
      if (handle === null) {
        diagnostic = expired ? 'workspace-expired' : 'workspace-reattach-failed';
        // Evaluated once, and outside both branches: a lease already spent is not a
        // release that failed, and recording it as one would name something that never
        // happened. It throws `unavailable`, which is honest — nothing was released and
        // nothing was created — and the identity survives either way.
        const releaseTimeoutMs = remaining();
        if (expired) {
          // The provider's HARD deadline has passed, so the session auto-released itself.
          // There is nothing here to leak, the call is a courtesy, and a failure means the
          // identity was already gone — which is the outcome asked for. A replacement is
          // correct, and this is the ONLY branch where swallowing is.
          await deps.browser.release(ref, releaseTimeoutMs).catch(() => undefined);
        } else {
          try {
            await deps.browser.release(ref, releaseTimeoutMs);
          } catch {
            // NOT swallowed, and NO replacement is made. `release` already resolves
            // `InvalidSessionId` and a 404 as SUCCESS — on a release, "the stored identity
            // is gone" is the outcome asked for — so a throw is an outage, a capacity
            // refusal or a policy denial, and the remote session is very possibly still
            // running. Creating a replacement here would overwrite `checkpoint.workspaceId`
            // and erase the only durable record of it: the reaper reads `run_workspace`,
            // and that row would name the new workspace, so nothing could ever release the
            // old one. It would be held until the provider's own plan deadline with no
            // operator able to find it.
            //
            // So the attempt ends instead, keeping the identity. The next claim reattaches
            // (failing again) and retries the release; the attempt budget bounds that, and
            // when it is spent the row is FAILED and STILL names the workspace — which is
            // the property that matters, because the reaper is what finishes the job once
            // the Run has ended.
            throw new StaleReleaseFailed();
          }
        }
        workspaceReplaced = true;
      } else {
        diagnostic = 'workspace-reattached';
      }
    }
    handle ??= await deps.browser.create({
      runId: run.runId,
      policy: { allowedOrigins: requirement.allowedOrigins },
      timeoutMs: remaining(),
    });
  } catch (error) {
    const code = failureCode(error);
    // A failed release of the stale identity is its own outcome and never a provision
    // code: nothing was created, so `TERMINAL_CODES` — which answers "will CREATING refuse
    // identically again?" — has no bearing on it. It is retryable under the same budget,
    // because a retry costs one reattach and one release against a session that may still
    // be alive, and that is exactly the case worth spending an attempt on.
    const releaseFailed = error instanceof StaleReleaseFailed;
    const failure: WorkspaceDiagnostic = releaseFailed
      ? 'workspace-release-failed'
      : diagnosticOf(code);
    const spent = (releaseFailed ? false : terminalCode(code)) || checkpoint.attempts >= budget;
    const { state } = runStopFor('session-step-failed');
    // `...checkpoint` carries `workspaceId` and `expiresAt` forward UNCHANGED, which is
    // what keeps a workspace nothing could give back nameable — by the next claim, and by
    // the reaper after this Run has ended.
    const next: WorkspaceCheckpoint = {
      ...checkpoint,
      revision: checkpoint.revision + 1,
      status: spent ? 'FAILED' : 'RETRY',
      diagnostic: failure,
    };
    const committed = await guarded(async (context) => {
      await context.save(next, spent ? state : 'RUNNING');
      await context.saveStepExecution({
        stepExecutionId,
        planStepId: checkpoint.stepId,
        workItemId: null,
        action: WORKSPACE_ACTION,
        state: 'FAILED',
        attempt: checkpoint.attempts,
        startedAt,
        completedAt: deps.clock.now().toISOString(),
        diagnostic: failure,
      });
      await event(context, failure, spent ? state : 'RUNNING', next, { attempt: checkpoint.attempts }, 'failure');
      if (spent) {
        await completeRun(context, {
          run,
          state,
          at: deps.clock.now().toISOString(),
          plan,
        });
      }
    });
    return { retry: committed && !spent, provisioned: false };
  }

  const denials = handle.takeDenials();
  const deniedTotal = handle.denied();
  const open: WorkspaceCheckpoint = {
    ...checkpoint,
    revision: checkpoint.revision + 1,
    status: 'OPEN',
    workspaceId: handle.ref.workspaceId,
    expiresAt: handle.expiresAt,
    mode: handle.ref.mode,
    leaseUntil: new Date(deps.clock.now().getTime() + stepTimeoutMs).toISOString(),
    diagnostic: null,
  };
  const committed = await guarded(async (context) => {
    await context.save(open, 'RUNNING');
    await context.saveStepExecution({
      stepExecutionId,
      planStepId: checkpoint.stepId,
      workItemId: null,
      action: WORKSPACE_ACTION,
      state: 'SUCCEEDED',
      attempt: checkpoint.attempts,
      startedAt,
      completedAt: deps.clock.now().toISOString(),
      diagnostic: null,
    });
    await event(context, diagnostic, 'RUNNING', open, {
      attempt: checkpoint.attempts,
      ...(deniedTotal > 0 ? { deniedTotal } : {}),
    });
    await recordDenials(context, denials);
  });
  // The claim was lost while the browser was being created — another worker holds this
  // Run. The workspace this attempt made is nobody's, so it is released here rather than
  // left for the reaper: the reaper only looks at Runs that have ENDED.
  if (!committed) {
    await deps.browser.release(handle.ref, stepTimeoutMs).catch(() => undefined);
    return { retry: false, provisioned: false };
  }
  return workspaceReplaced
    ? { retry: false, provisioned: true, workspaceReplaced: true }
    : { retry: false, provisioned: true };
}

/**
 * Release the Run's workspace and revoke its credentials, once the Run has ended.
 *
 * Idempotent, and safe to call for a Run that has no workspace, was never agent-driven, or
 * is still running — the whole decision is taken from the durable row inside a transaction.
 *
 * A workspace is bound to its Run for the Run's LIFETIME (AD-16), so this releases nothing
 * while the Run can still act: a Run that resumes after a wait must reattach to the
 * workspace it left rather than sign in again.
 */
export async function releaseWorkspace(
  deps: WorkspaceDependencies,
  runId: string,
): Promise<{ released: boolean }> {
  const claim = await deps.repository.transaction(runId, async (context) => {
    const prior = context.checkpoint;
    if (prior === null || prior.status === 'RELEASED') return null;
    // A Run that can still act keeps its workspace. "Absent" is a real case here and not a
    // dangling row: `run_workspace` carries a real foreign key, so the only way to reach a
    // null Run is a row read for a Run being removed underneath us, and that workspace is
    // certainly nobody's.
    if (context.run !== null && !runIsOver(context.run.state)) return null;
    if (prior.workspaceId === null) {
      // Nothing was ever provisioned under this row — an attempt died between the claim
      // and the provider answering. There is no identity to release, and the row is closed
      // so the reaper stops selecting it. The window in which a provider session exists
      // and no row names it is real and is bounded by the provider's own grace timer;
      // nothing on this side can release a session it cannot name.
      await context.save(
        {
          ...prior,
          revision: prior.revision + 1,
          status: 'RELEASED',
          releasedAt: deps.clock.now().toISOString(),
        },
        context.run?.state ?? 'RUN_FAILED',
      );
      return null;
    }
    const now = deps.clock.now();
    const expired =
      prior.mode === 'solari' &&
      prior.expiresAt !== null &&
      Date.parse(prior.expiresAt) <= now.getTime();
    return {
      checkpoint: prior,
      ref: { runId, workspaceId: prior.workspaceId, mode: prior.mode } satisfies WorkspaceRef,
      state: context.run?.state ?? 'RUN_FAILED',
      expired,
    };
  });
  if (claim === null) return { released: false };

  let denials: readonly WorkspaceDenial[] = [];
  let deniedTotal = 0;
  if (!claim.expired) {
    // The last chance to collect what the workspace refused: the denial log dies with the
    // workspace, so it is drained before the release rather than after it.
    const handle = await deps.browser.attach(claim.ref).catch(() => null);
    denials = handle?.takeDenials() ?? [];
    deniedTotal = handle?.denied() ?? 0;
    // An unexpired identity may still be alive. A provider failure must leave its identity
    // on the row so the reaper can retry it, rather than falsely marking it released.
    await deps.browser.release(claim.ref, WORKSPACE_RELEASE_TIMEOUT_MS);
  } else {
    // A persisted Solari deadline is authoritative: the provider has already auto-released
    // this identity. Release is only a courtesy, so an unavailable provider cannot keep a
    // terminal row reapable forever. The identity remains on the released row for audit
    // correlation, and the expiry diagnosis distinguishes this from an acknowledged release.
    await deps.browser.release(claim.ref, WORKSPACE_RELEASE_TIMEOUT_MS).catch(() => undefined);
  }

  await deps.repository.transaction(runId, async (context) => {
    if (context.checkpoint?.revision !== claim.checkpoint.revision) return;
    const released: WorkspaceCheckpoint = {
      ...claim.checkpoint,
      revision: claim.checkpoint.revision + 1,
      status: 'RELEASED',
      releasedAt: deps.clock.now().toISOString(),
      diagnostic: claim.expired ? 'workspace-expired' : null,
    };
    await context.save(released, claim.state);
    await event(context, claim.expired ? 'workspace-expired' : 'workspace-released', claim.state, released, {
      ...(deniedTotal > 0 ? { deniedTotal } : {}),
    });
    await recordDenials(context, denials);
  });
  return { released: true };
}
