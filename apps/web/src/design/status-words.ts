import type { StatusState } from './status';

/**
 * What a status MEANS, said beside the badge that names it
 * (UI cleanup 2026-09-21, UX-18, UX-19, UX-49).
 *
 * The walkthrough found `Completed`, `Control Failure` and a green `Passed` on one line
 * with nothing saying which of the three is about the evidence, which is about the
 * control, and which is about a person's decision — so a reader could take a passed
 * Evidence Quality Gate for a passed control, or a finished Run for a finished review.
 * The badge words are DESIGN.md's and do not move; these are the three questions the
 * columns answer and a one-line meaning for every state, so the three families can never
 * be read as one thing.
 *
 * Typed against the badge vocabulary, so a state added to `status.ts` without a meaning
 * here fails to compile rather than rendering a badge nobody explained.
 */

/** The three questions a Run's status answers, as column headers and section labels. */
export const STATUS_COLUMN_WORDS = {
  execution: 'Execution',
  assessment: 'Assessment',
  evidenceChecks: 'Evidence checks',
} as const;

export const EXECUTION_MEANINGS: Readonly<Record<StatusState<'run-lifecycle'>, string>> = {
  Queued: 'Waiting for a worker to start it.',
  Running: 'The agent is working now.',
  Paused: 'Held by a person. Nothing is being checked until it resumes.',
  'Awaiting Auditor': 'Waiting for your answer before it can continue.',
  Completed: 'The test finished.',
  Inconclusive: 'Stopped before a conclusion could be issued.',
  'Run Failed': 'Stopped by a failure.',
  Canceled: 'Stopped by a person.',
};

export const ASSESSMENT_MEANINGS: Readonly<Record<StatusState<'result-outcome'>, string>> = {
  Pass: 'Every record checked met the control.',
  'Control Failure': 'At least one record did not meet the control.',
  'Pending Confirmation': 'Your review of the agent’s assessments is needed before a conclusion is issued.',
  'No conclusion issued': 'No assessment is available for this Run.',
};

export const EVIDENCE_CHECK_MEANINGS: Readonly<Record<StatusState<'evidence-quality-gate'>, string>> = {
  Passed: 'Evidence checks passed. This says the evidence can be relied on, not that the control passed.',
  'Not passed': 'Evidence checks found a problem, so no conclusion rests on this Run.',
  Incomplete: 'Evidence checks did not finish.',
  'Not evaluated': 'Evidence checks have not run.',
};

/**
 * `Object.hasOwn` on every lookup: the words are keyed by a badge state the caller derived
 * from a stored value, and a plain index answers `'constructor'` with a function.
 */
function meaning<K extends string>(table: Readonly<Record<K, string>>, key: K): string {
  return Object.hasOwn(table, key) ? table[key] : '';
}

export const executionMeaning = (state: StatusState<'run-lifecycle'>): string =>
  meaning(EXECUTION_MEANINGS, state);
export const assessmentMeaning = (outcome: StatusState<'result-outcome'>): string =>
  meaning(ASSESSMENT_MEANINGS, outcome);
export const evidenceChecksMeaning = (word: StatusState<'evidence-quality-gate'>): string =>
  meaning(EVIDENCE_CHECK_MEANINGS, word);

/**
 * What an unsealed Result needs from the reader, with the exact count.
 *
 * The contract's own sentence is `{n} Agent-Judged evaluations await confirmation`; this
 * says the same fact as the action it asks for, which is what the walkthrough asked of
 * `Completed + Pending Confirmation` (“Test finished · Your assessment review is needed”).
 */
export function pendingAssessmentSentence(count: number): string {
  return count === 1
    ? '1 of the agent’s assessments needs your confirmation.'
    : `${count.toLocaleString('en-US')} of the agent’s assessments need your confirmation.`;
}
