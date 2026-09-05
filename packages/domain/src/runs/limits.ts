import { EXECUTABLE_PLAN_LIMITS, type ExecutablePlan } from '../procedures/executable-plan.js';

/**
 * The safe mapping from an exhausted limit or a failed unit to a Run outcome (§E.1,
 * Story 3.8).
 *
 * Pure. No I/O, no clock, no host types.
 *
 * There is exactly one rule underneath all of it: **Evidence falling short is
 * `INCONCLUSIVE`; execution or integrity failing is `RUN_FAILED`; and neither is ever
 * `CANCELED`.** `CANCELED` is reserved for a person cancelling a Run (§E, Story 3.10). A
 * timeout that produced it would put a Run nobody cancelled into the one state whose whole
 * meaning is that somebody did — and the Result rules read that state to decide what a
 * human may do next.
 *
 * The limits themselves are NOT restated here. They are frozen in the Procedure Version's
 * executable plan and read from it; `EXECUTABLE_PLAN_LIMITS` is referenced only so a Run
 * with no readable plan is still bounded by something rather than by nothing.
 */

/**
 * Every way a Run can be stopped by this story, as a closed vocabulary.
 *
 * `run-step-execution-limit`, `run-time-limit` and `run-token-limit` are the three
 * Run-level limits the plan freezes. `session-step-failed` is §E's Run-level Session Step
 * class — workspace creation, Population Source acquisition, Target System sign-in and
 * Adapter extraction — after bounded retries. `action-denied` and `scope-violation` are
 * §E.1's security causes. `integrity-mismatch` is a stored artifact disagreeing with its
 * registered digest WHILE the Run is running; the same disagreement after the Run is an
 * Audit Trail integrity event that changes no state (evidence package v1).
 */
export const RUN_LIMIT_CAUSES = [
  'run-step-execution-limit',
  'run-time-limit',
  'run-token-limit',
] as const;
/** The three Run-level limits, and the only causes `exhaustedRunLimit` can return. */
export type RunLimitCause = (typeof RUN_LIMIT_CAUSES)[number];

export const RUN_STOP_CAUSES = [
  ...RUN_LIMIT_CAUSES,
  'session-step-failed',
  'action-denied',
  'scope-violation',
  'integrity-mismatch',
] as const;
export type RunStopCause = (typeof RUN_STOP_CAUSES)[number];

export function isRunStopCause(value: unknown): value is RunStopCause {
  return typeof value === 'string' && (RUN_STOP_CAUSES as readonly string[]).includes(value);
}

/** The two states this story may produce. `CANCELED` and `COMPLETED` are not among them. */
export const RUN_STOP_STATES = ['INCONCLUSIVE', 'RUN_FAILED'] as const;
export type RunStopState = (typeof RUN_STOP_STATES)[number];

export interface RunStopDecision {
  readonly cause: RunStopCause;
  readonly state: RunStopState;
  /**
   * Does §E.1 additionally require a security event?
   *
   * "a limit breach caused by a denied action or scope violation stops the Run as
   * `RUN_FAILED` and is logged as a security event." Two causes, and the flag is on the
   * decision rather than remembered by each caller, because a caller that forgets it
   * silently drops the only record that the platform was told no.
   */
  readonly securityEvent: boolean;
}

/**
 * §E.1's limit-exhaustion mapping, as a table.
 *
 * Written out per cause rather than derived from a predicate: the addendum is a table and
 * a transcription of a table is checkable against it, while a clever predicate is a claim
 * about a table nobody can compare with it.
 */
const RUN_STOP_TABLE: Readonly<Record<RunStopCause, { state: RunStopState; securityEvent: boolean }>> = {
  // "exhausting the Run-level Step Execution, time, or token limit stops the Run as
  // INCONCLUSIVE with partial Evidence preserved".
  'run-step-execution-limit': { state: 'INCONCLUSIVE', securityEvent: false },
  'run-time-limit': { state: 'INCONCLUSIVE', securityEvent: false },
  'run-token-limit': { state: 'INCONCLUSIVE', securityEvent: false },
  // §E: "their failure after bounded retries yields RUN_FAILED".
  'session-step-failed': { state: 'RUN_FAILED', securityEvent: false },
  'action-denied': { state: 'RUN_FAILED', securityEvent: true },
  'scope-violation': { state: 'RUN_FAILED', securityEvent: true },
  // Evidence package v1: during the Run, a stored artifact disagreeing with its registered
  // digest is terminal and the bytes are untouched.
  'integrity-mismatch': { state: 'RUN_FAILED', securityEvent: false },
};

/** The safe outcome for one cause. `Object.hasOwn`, because a cause can be request-shaped. */
export function runStopFor(cause: RunStopCause): RunStopDecision {
  if (!Object.hasOwn(RUN_STOP_TABLE, cause)) {
    // An unknown cause is not a reason to keep running. Fail closed, and never as a
    // security event: claiming the platform was denied when nobody said so is its own lie.
    return { cause, state: 'RUN_FAILED', securityEvent: false };
  }
  const entry = RUN_STOP_TABLE[cause];
  return { cause, state: entry.state, securityEvent: entry.securityEvent };
}

/**
 * Partial Evidence is preserved on EVERY stop this module can produce.
 *
 * Not a flag a caller could set: the Evidence package is sealed by `SealPackage` at every
 * terminal transition and a `REGISTERED` artifact is never demoted, so preservation is a
 * property of the mechanism rather than a promise made per branch. It is stated as a
 * function so a test can assert the property over the whole vocabulary rather than over
 * the branches somebody remembered to write.
 */
export function preservesPartialEvidence(_cause: RunStopCause): true {
  return true;
}

/** What one Run has spent against the limits its plan froze. */
export interface RunLimitUsage {
  /** Step Executions started by this Run, whatever their outcome. */
  readonly stepExecutions: number;
  /** Milliseconds since the Run's own start, from the durable checkpoint. */
  readonly elapsedMs: number;
  /**
   * Model tokens this Run has spent.
   *
   * Zero for every Run of this epic: the adapter execution path calls no model at all, and
   * a number nobody measured must not be invented. The mapping exists and is exercised so
   * the agent epic fills a counter rather than adding a limit.
   */
  readonly tokens: number;
}

/** The frozen Run-level limits, exactly as the plan carries them. */
export type FrozenRunLimits = ExecutablePlan['limits'];

/**
 * Which Run-level limit this usage has reached, or `null`.
 *
 * Checked in the addendum's order — Step Executions, time, tokens — so a Run that reached
 * two at once reports the first one §E.1 names. Reaching a limit is `>=`, not `>`: a limit
 * of ten thousand Step Executions means the ten-thousand-and-first must not start.
 */
export function exhaustedRunLimit(
  usage: RunLimitUsage,
  limits: FrozenRunLimits | null,
): RunLimitCause | null {
  // A plan this build cannot read is still bounded, by the compiler-1 constants the plan
  // would have frozen. Unbounded is not one of the answers.
  const frozen = limits ?? EXECUTABLE_PLAN_LIMITS;
  if (usage.stepExecutions >= frozen.runStepExecutions) return 'run-step-execution-limit';
  if (usage.elapsedMs >= frozen.runTimeoutSeconds * 1000) return 'run-time-limit';
  if (usage.tokens >= frozen.runTokens) return 'run-token-limit';
  return null;
}

/**
 * The bounded retry budget for one unit, from the plan's frozen per-Step retry limit.
 *
 * One cycle is the first attempt plus `retriesPerStep` retries. The owner's 2026-09-05
 * decision grants an adapter Work Item exactly ONE more such cycle after the first is
 * exhausted, automatically and with no human Escalation; a second exhaustion marks the
 * item `FAILED`, the Run continues, and incomplete coverage becomes `INCONCLUSIVE` at the
 * Run-level Gate. A Run-level Session Step gets one cycle and no more, because §E maps its
 * failure to `RUN_FAILED` rather than to a coverage gap.
 */
export const ADAPTER_RETRY_CYCLES = 2;
export const SESSION_STEP_RETRY_CYCLES = 1;

export function attemptsPerCycle(limits: FrozenRunLimits | null): number {
  return (limits ?? EXECUTABLE_PLAN_LIMITS).retriesPerStep + 1;
}

export function adapterAttemptBudget(limits: FrozenRunLimits | null): number {
  return attemptsPerCycle(limits) * ADAPTER_RETRY_CYCLES;
}

export function sessionStepAttemptBudget(limits: FrozenRunLimits | null): number {
  return attemptsPerCycle(limits) * SESSION_STEP_RETRY_CYCLES;
}
