import type { ExecutablePlan } from '@intellifin/domain';
import type { RunFrameRow, RunStepExecutionRow } from '@intellifin/infrastructure';

import { planActionWord, toolActionNameWord, utcStamp } from './labels';

/**
 * The session viewer's four state words (UX-DR24, DESIGN.md → Session viewer).
 *
 * A CLOSED vocabulary, and the dot beside each word is a token this stylesheet paints.
 * It describes a SESSION, which is why a Queued Run maps to none of them: there is no
 * session yet, and stretching `LIVE` over a Run that has not started would be the
 * "Active version: Draft" defect in a new place.
 */
export const LIVE_VIEW_CHROME = ['LIVE', 'PAUSED', 'AWAITING', 'REPLAY'] as const;
export type LiveViewChrome = (typeof LIVE_VIEW_CHROME)[number];

/**
 * Which word the chrome strip shows for a Run state, or `null` when there is no session.
 *
 * `Object.hasOwn` is unnecessary here because the branch is a switch over the domain's own
 * state vocabulary and an unknown value falls through to `null`, which the surface renders
 * as "no session" rather than as a word it made up.
 */
export function liveViewChrome(state: string): LiveViewChrome | null {
  switch (state) {
    case 'RUNNING':
      return 'LIVE';
    case 'PAUSED':
      return 'PAUSED';
    case 'AWAITING_AUDITOR':
      return 'AWAITING';
    case 'COMPLETED':
    case 'INCONCLUSIVE':
    case 'RUN_FAILED':
    case 'CANCELED':
      return 'REPLAY';
    default:
      // QUEUED, and any state this build does not know. Both are "no session yet".
      return null;
  }
}

/** The dot's modifier class, so a reader never has colour alone: word and dot together. */
export function chromeDotClass(chrome: LiveViewChrome): string {
  return `ls-session__dot ls-session__dot--${chrome.toLowerCase()}`;
}

/**
 * How many Step Executions the frozen plan can produce at most — the denominator of the
 * chrome's Step counter.
 *
 * Read from the plan the Run is executing, never from a stored progress number: the plan
 * is what an auditor reads, and a counter derived from anything else could disagree with
 * it. One Session Step each, plus each Target System's three plan steps.
 */
export function plannedStepCount(plan: ExecutablePlan | null): number | null {
  if (plan === null) return null;
  return plan.sessionSteps.length + plan.targetSystems.reduce((total, target) => total + target.planSteps.length, 0);
}

/**
 * The narration of one Step Execution, in words.
 *
 * ONE function, used by the Step row AND by the frame's `alt` — EXPERIENCE.md's
 * accessibility rule is that "session viewer frames carry an `alt` narration equal to the
 * Step narration", and two implementations of "the narration" would satisfy that sentence
 * on the day they were written and diverge on the first value nobody tried.
 */
export function stepNarration(
  execution: Pick<RunStepExecutionRow, 'action' | 'planStepId' | 'startedAt'>,
  targetName: string | null,
): string {
  const where = targetName === null ? '' : ` on ${targetName}`;
  return `${planActionWord(execution.action)}${where}, plan step ${execution.planStepId}, started ${utcStamp(execution.startedAt)}.`;
}

/**
 * What the stage says when there is no frame to show, in words rather than as a gap.
 *
 * Each sentence names WHY there is no picture. An empty stage with no explanation is the
 * defect class this codebase keeps finding: a reader takes an absence for "nothing
 * happened here", and on a supervision surface that is the opposite of the truth.
 */
export const LIVE_VIEW_STAGE = {
  /** The Run has a workspace and has captured nothing yet. */
  awaitingFirstFrame: 'No workspace screen has been captured yet. The first frame appears when the Agent captures one.',
  /** The frozen plan needs no browser at all: every Target System is adapter-acquired. */
  adapterOnly: 'This Run uses no Agent Workspace. Its Adapter Session Steps are listed below with their counts and integrity digests.',
  /** The registered frame could not be read back through its grant. */
  unavailable: 'The latest workspace screen could not be read from Evidence storage. Its Evidence record is unchanged.',
} as const;

/** The one Step the viewer is narrating: the newest Step Execution, or nothing yet. */
export function currentStepExecution(
  executions: readonly RunStepExecutionRow[],
): RunStepExecutionRow | null {
  let current: RunStepExecutionRow | null = null;
  for (const execution of executions) {
    if (current === null || Date.parse(execution.startedAt) >= Date.parse(current.startedAt)) current = execution;
  }
  return current;
}

/** The frame's own narration: its Step Execution's, so the two are one string. */
export function frameNarration(
  frame: RunFrameRow,
  execution: Pick<RunStepExecutionRow, 'action' | 'planStepId' | 'startedAt'> | null,
  targetName: string | null,
): string {
  if (execution !== null) return stepNarration(execution, targetName);
  // The Step Execution could not be resolved. Narrate the ACTION that captured the frame
  // rather than inventing a Step: what is said is still true of the picture.
  const where = targetName === null ? '' : ` on ${targetName}`;
  return `${toolActionNameWord(frame.action)}${where}, captured ${utcStamp(frame.actionStartedAt)}.`;
}
