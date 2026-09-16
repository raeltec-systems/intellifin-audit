import { isActiveRunState, isPopulationCheckName, type PopulationCheckName } from '@intellifin/domain';

import { countText, wordFor } from './labels';
import { POPULATION_CHECK_WORDS, POPULATION_FAILURE_WORDS, WORKSPACE_WORDS } from './stop-reason';

/**
 * The two session-preparation stages, in the auditor's words (owner review, 2026-09-16).
 *
 * A production Run ended five seconds in, with its population acquired and no record
 * tested. Every surface that had the facts said them as codes or not at all: the Evidence
 * tab said "Target checks are pending" over a Run that had stopped, listed its §H checks
 * as `complete-inclusion: Failed`, and said nothing about the four rows the inclusion rule
 * could not place; the Execution Timeline said "0 of 0 Step Executions are listed" beside
 * a workspace row whose status and diagnostic were both raw stored codes.
 *
 * PRESENTATION ONLY, and the same discipline as `stop-reason.ts`: every table keyed by a
 * stored value goes through `Object.hasOwn`, the per-check tables are typed against the
 * DOMAIN's own `PopulationCheckName` so a check added there without words here fails to
 * COMPILE, and the stage sentences are imported from `stop-reason.ts` rather than retyped
 * — two copies would agree on every check anybody tried and diverge on the first one
 * nobody did.
 */

/** The `Object.hasOwn` lookup that answers `null`, so a caller can show the stored code. */
function sentenceIn(table: Readonly<Record<string, string>>, key: string): string | null {
  return Object.hasOwn(table, key) ? table[key]! : null;
}

/* ------------------------------------------------------------ status words --- */

/**
 * `run_workspace.status`, in words. A RELEASED workspace is not a failure: the worker
 * gives a healthy workspace back in its `finally`, so "Released" is the ordinary end of a
 * Run that used one.
 */
const WORKSPACE_STATUS_WORDS: Readonly<Record<string, string>> = {
  PROVISIONING: 'Provisioning',
  OPEN: 'Open',
  RETRY: 'Retrying',
  RELEASED: 'Released',
  FAILED: 'Failed',
};

export const workspaceStatusWord = (status: string): string => wordFor(WORKSPACE_STATUS_WORDS, status);

/**
 * `population_execution.status`, in words.
 *
 * `TERMINAL` is the stage ending without a population, which is a stop; `POPULATION_READY`
 * is a population this Run can execute over, whatever became of the Run afterwards.
 */
const POPULATION_STATUS_WORDS: Readonly<Record<string, string>> = {
  ACQUIRING: 'Acquiring',
  RETRY: 'Retrying',
  POPULATION_READY: 'Acquired',
  TERMINAL: 'Stopped',
};

export const populationStatusWord = (status: string): string => wordFor(POPULATION_STATUS_WORDS, status);

const populationStageStopped = (status: string): boolean => status === 'TERMINAL';

/* ------------------------------------------------------------- diagnostics --- */

/** The Agent Workspace diagnostic in words, or `null` for a code this build has none for. */
export function workspaceDiagnosticSentence(diagnostic: string | null): string | null {
  return diagnostic === null ? null : sentenceIn(WORKSPACE_WORDS, diagnostic);
}

/**
 * The population diagnostic in words, in the three shapes `acquirePopulation` writes it.
 *
 * It is the failed CHECK NAMES joined by `, `, or `population-<code>-failed`, or one of
 * the Run-limit codes every stage shares. The limit vocabulary is spread into each stage
 * table rather than exported on its own, so `WORKSPACE_WORDS` is read for that last case:
 * it is the same table `stop-reason.ts` builds from `LIMIT_WORDS`, and a code outside all
 * three still answers `null` so the caller shows what was stored.
 */
export function populationDiagnosticSentence(diagnostic: string | null): string | null {
  if (diagnostic === null) return null;
  const names = diagnostic.split(', ');
  if (names.every(isPopulationCheckName)) {
    return names.map((name) => POPULATION_CHECK_WORDS[name]).join(' ');
  }
  const failure = /^population-([a-z]+)-failed$/.exec(diagnostic)?.[1];
  if (failure !== undefined) return sentenceIn(POPULATION_FAILURE_WORDS, failure);
  return sentenceIn(WORKSPACE_WORDS, diagnostic);
}

/* ------------------------------------------------------ the §H check rows --- */

/**
 * What each population check ASSERTS, so a row reads correctly whichever way it went.
 *
 * `POPULATION_CHECK_WORDS` says what a FAILED check means, and putting that sentence
 * beside `Passed` would state the opposite of the row it is on. So the affirmative title
 * is here and the failure sentence is added only when the check failed — the stored name
 * stays beside both in monospace, for an operator who greps.
 */
const POPULATION_CHECK_TITLES: Readonly<Record<PopulationCheckName, string>> = {
  parse: 'The file reads as records',
  declaration: 'The declaration can be read',
  'response-contract': 'The answer is in a shape this platform reads',
  'declared-count': 'The declared number of records matches the file',
  'declared-digest': 'The declared fingerprint matches the file',
  'declared-schema': 'The declared columns match the file',
  'declared-period': 'The declaration covers the Run period',
  'complete-extraction': 'The extraction is complete',
  generation: 'The declaration names the snapshot generation',
  'source-identity': 'The declaration names the source of the snapshot',
  freshness: 'The snapshot is fit for the Run period',
  'complete-inclusion': 'Every record was placed inside or outside the Run period',
  'nonempty-population': 'The Run period holds at least one record',
};

/** The check's own claim in words, or `null` for a name this build does not hold. */
export function populationCheckTitle(name: string): string | null {
  return sentenceIn(POPULATION_CHECK_TITLES, name);
}

/** Why a failed check failed, in words. `POPULATION_CHECK_WORDS`, guarded. */
export function populationCheckSentence(name: string): string | null {
  return sentenceIn(POPULATION_CHECK_WORDS, name);
}

/* --------------------------------------------------------------- sentences --- */

export const POPULATION_PENDING_SENTENCE = 'Population verified. Target checks are pending.';

/**
 * The sentence the owner's Run needed. It had a verified population, no Step Execution and
 * no Observation, and the tab said its target checks were still pending — over a Run that
 * had been over for a day.
 */
export const POPULATION_ENDED_BEFORE_CHECKS_SENTENCE =
  'Population verified. The Run ended before any target check ran.';

export const POPULATION_CHECKS_RAN_SENTENCE =
  'Population verified. Target checks ran, and each record tested has an Observation.';

export const POPULATION_STOPPED_SENTENCE = 'Population acquisition stopped.';

export const POPULATION_IN_PROGRESS_SENTENCE = 'Population acquisition is in progress.';

/**
 * What the population stage means for THIS Run, read from the stage AND the Run state.
 *
 * The stage status alone says only that a population was acquired; whether target checks
 * are still to come is a fact about the Run. An Observation count refines the terminal
 * arm, because a Run that tested records and then stopped did not end "before any target
 * check ran".
 */
export function populationProgressSentence({
  status,
  runState,
  observations,
}: {
  readonly status: string;
  readonly runState: string;
  readonly observations: number;
}): string {
  if (status !== 'POPULATION_READY') {
    return populationStageStopped(status) ? POPULATION_STOPPED_SENTENCE : POPULATION_IN_PROGRESS_SENTENCE;
  }
  if (isActiveRunState(runState)) return POPULATION_PENDING_SENTENCE;
  if (runState === 'COMPLETED') return POPULATION_CHECKS_RAN_SENTENCE;
  return observations > 0 ? POPULATION_CHECKS_RAN_SENTENCE : POPULATION_ENDED_BEFORE_CHECKS_SENTENCE;
}

/**
 * The rows the inclusion rule could not place, and what they cost.
 *
 * A count in a definition list is a number; what an auditor needs is that these rows are
 * neither in nor out of the period and that §H counts every one of them as unaccounted.
 */
export function indeterminateRowsSentence(indeterminate: number): string {
  return `${POPULATION_CHECK_WORDS['complete-inclusion']} ${countText(indeterminate)} rows are in that state, and each one counts as an unaccounted row at the Evidence Quality Gate.`;
}

/** What a Timeline with Step Executions says, unchanged. */
export function stepExecutionsListedSentence(listed: number, total: number): string {
  return `${countText(listed)} of ${countText(total)} Step Executions are listed. Step Executions are collapsed under the unit that started them; a unit with a failure is expanded.`;
}

export const NO_STEP_EXECUTIONS_ENDED_SENTENCE =
  'No Step Execution started, so no record was tested. The Run ended while it was still preparing the session — creating the Agent Workspace and acquiring the population.';

export const NO_STEP_EXECUTIONS_PENDING_SENTENCE =
  'No Step Execution has started yet. The Run is still preparing the session — creating the Agent Workspace and acquiring the population.';

/**
 * The Timeline's own headline. `0 of 0 Step Executions are listed` is an arithmetic fact
 * that reads as a rendering fault; what it means is that nothing was tested, and the rows
 * above it say which preparation stage the Run was in when it stopped.
 */
export function stepExecutionsSentence(listed: number, total: number, runState: string): string {
  if (total > 0) return stepExecutionsListedSentence(listed, total);
  return isActiveRunState(runState) ? NO_STEP_EXECUTIONS_PENDING_SENTENCE : NO_STEP_EXECUTIONS_ENDED_SENTENCE;
}
