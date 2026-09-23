import type { PlanDerivationAttempt } from '@intellifin/application';

/**
 * How the Builder speaks about the test plan (UI cleanup 2026-09-22, UX-16).
 *
 * "Retry plan derivation" and "Queue derivation attempt" named the worker's mechanism; an
 * auditor asked for a test plan and wants to know whether THEY need to change something or
 * the platform needs another try. These are the platform's own sentences, pinned by
 * `plan-words.test.ts`, and the browser spec imports them rather than retyping them.
 */
export const PLAN_RECOVERY_LABEL = 'Test plan preparation';
export const PLAN_NOT_PREPARED_TITLE = 'The test plan could not be prepared';
export const PLAN_DRAFT_INCOMPLETE = 'Something is missing in your draft.';
export const PLAN_PLATFORM_FAILED =
  'The platform could not prepare the test plan. Nothing in your draft needs to change; try preparing it again.';
export const PLAN_RETRY_LABEL = 'Try preparing the test plan again';
export const PLAN_RETRY_CONFIRM = 'Prepare the test plan';
export const PLAN_RETRY_QUEUED = 'The test plan is being prepared again.';
export const PLAN_RETRY_ALREADY_QUEUED = 'The test plan is already being prepared again.';

export function planRetryConsequence(versionNumber: number, name: string): string {
  return `The platform prepares the test plan for Draft version ${versionNumber} of ${name} again from your saved sections. It does not run the procedure or change what you wrote.`;
}

/** Each recorded attempt, in words, for the Technical details list. */
export const PLAN_ATTEMPT_WORDS: Readonly<Record<PlanDerivationAttempt['outcome'], string>> = {
  started: 'started',
  success: 'prepared',
  failure: 'could not prepare',
  stale: 'set aside because the draft changed',
};
