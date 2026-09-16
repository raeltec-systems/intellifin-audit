import type { ExecutablePlan } from '@intellifin/domain';

import { countWords, durationWords } from './plan-numbers';

/**
 * What the frozen plan already decides about stopping, retrying and asking.
 *
 * The Schedule step used to be titled "Frequency and handling" and offered a frequency
 * and a time — so it promised a handling editor that does not exist. The handling is
 * real, it is simply not authored here: the compiler froze it with the version, and
 * `AgentSummary` was the only surface reading it. Two surfaces now show the same facts,
 * which is exactly why the words live here and not in either of them: an auditor reading
 * "stops after 10,000 steps" in one place and something slightly different in the other
 * is reading two answers to one question.
 *
 * Everything below is READ from the plan. Nothing is restated, defaulted or inferred:
 * a plan carrying different limits says different numbers, and a Draft with no plan
 * yet gets no facts at all rather than the compiler's current defaults dressed as this
 * version's.
 */

/** The one heading both surfaces use for these facts. */
export const HANDLING_HEADING = 'When it stops on its own';

export const STOPS_AFTER_LABEL = 'Stops after';
export const RETRIES_LABEL = 'Retries';
export const ASKS_A_PERSON_LABEL = 'Asks a person';

/** `10,000 steps, 1 hour, or 1,000,000 tokens — whichever comes first`. */
export function stopsAfterWords(limits: ExecutablePlan['limits']): string {
  return `${countWords(limits.runStepExecutions)} steps, ${durationWords(limits.runTimeoutSeconds)}, or ${countWords(limits.runTokens)} tokens — whichever comes first`;
}

/**
 * `A failed step 3 times`.
 *
 * The count is read through a `number` binding rather than the compiler's literal type,
 * so the pluralisation stays right if a later compiler version freezes a different bound
 * — and because `=== 1` against a literal `3` does not compile.
 */
export function retriesWords(limits: ExecutablePlan['limits']): string {
  const retries: number = limits.retriesPerStep;
  return `A failed step ${countWords(retries)} ${retries === 1 ? 'time' : 'times'}`;
}

/**
 * When the agent stops and asks somebody, or `null` when this plan has nothing to ask
 * about.
 *
 * The certainty threshold is a frozen authoring input and only bears on an Agent-Judged
 * condition; a plan whose conditions are all Rule-Classified never reaches it, and
 * printing a threshold there would describe a stop this version cannot make. The
 * threshold is a decimal string and is rendered exactly as frozen — never parsed, never
 * rounded.
 */
export function asksAPersonWords(plan: ExecutablePlan): string | null {
  const judged = plan.inputs.complianceConditions.filter((condition) => condition.status === 'AGENT_JUDGED');
  if (judged.length === 0) return null;
  return `When it is less than ${plan.inputs.agentJudgedThreshold} certain about a record, it leaves that record for a person to decide rather than guessing (${countWords(judged.length)} ${judged.length === 1 ? 'condition' : 'conditions'} of this plan are judged that way)`;
}
