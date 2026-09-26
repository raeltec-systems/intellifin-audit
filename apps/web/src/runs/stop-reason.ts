import {
  GATE_CHECKS,
  isPopulationCheckName,
  type PopulationCheckName,
} from '@intellifin/domain';
import {
  UNEXECUTABLE_RUN_REASONS,
  type AcquisitionFailureCode,
  type AdapterExecutionDiagnostic,
  type AgentExecutionDiagnostic,
  type AgentWorkDiagnostic,
  type WorkspaceDiagnostic,
} from '@intellifin/application';
import type { RunStopFacts, RunStopStage, WaitTimeoutDiagnostic } from '@intellifin/infrastructure';

import { escalationKindWord } from '../design/plain-words';
import { readableStamp } from '../design/time';

/**
 * Why a Run stopped, in the auditor's words (owner correction, 2026-09-15).
 *
 * A production page of Runs read as "all the runs failed", and the only thing on it that
 * said why was the Execution Timeline's monospace `freshness` — a code word under a row
 * nobody opened, for a fact that decides what the auditor does next (choose dates the
 * snapshot covers). The stages already record every stop as a CLOSED diagnostic; this
 * module is the one place those diagnostics become sentences, so the Runs list and the
 * Run header say the same thing and neither invents a reason the checkpoint did not
 * record.
 *
 * PRESENTATION ONLY. The vocabularies stay where the domain and the application define
 * them; every table here is typed against the owning union, so a diagnostic added there
 * without a sentence here fails to COMPILE rather than rendering its identifier at a
 * person (the `plain-words.ts` rule). A diagnostic this build does not know still gets a
 * sentence — one that names the stage and shows the code — because a stored value nobody
 * transcribed yet is a true statement about the row and a blank cell is not.
 */

/** The banner's heading on Run Detail. Here, not in the component, so a browser spec can import it. */
export const STOP_REASON_TITLE = 'Why this Run stopped';

/**
 * The two states a stop sentence exists for.
 *
 * `COMPLETED` concluded, an active Run has not stopped, and `CANCELED` has a banner that
 * already names the person and the time — a second sentence saying "a person canceled it"
 * would compete with the one that says who. The list and the header both read the stop
 * facts only for these two, so this is the one place that decision is spelled.
 */
export function isStoppedState(state: string): boolean {
  return state === 'INCONCLUSIVE' || state === 'RUN_FAILED';
}

/* ------------------------------------------------------------- population --- */

/**
 * One sentence per population check (addendum §H, the acquisition rows).
 *
 * `Record<PopulationCheckName, …>`, so a check added to the reconciler without a sentence
 * here does not typecheck. `freshness` is refined with the stored dates below; the plain
 * entry is what a row with no readable generation time gets.
 */
export const POPULATION_CHECK_WORDS: Readonly<Record<PopulationCheckName, string>> = {
  parse: 'The Population Source file could not be read as records.',
  declaration: 'The Population Source has no declaration this platform can read.',
  'response-contract': 'The Population Source answered in a shape this platform does not read.',
  'declared-count': 'The declaration states a different number of records than the file holds.',
  'declared-digest': 'The declaration states a different fingerprint than the file has.',
  'declared-schema': 'The declaration states different columns than the file has.',
  'declared-period': 'The declaration covers a period that does not include the Run period.',
  'complete-extraction': 'The Population Source says its extraction is not complete.',
  generation: 'The declaration does not name the snapshot generation.',
  'source-identity': 'The declaration does not name the source of the snapshot.',
  freshness: 'The declaration has no generation time this platform can read.',
  'complete-inclusion': 'A record could not be placed inside or outside the Run period.',
  'nonempty-population': 'The Population Source holds no records for the Run period.',
};

/** What to do about a stale snapshot. Said beside the fact, because the fact alone is a wall. */
export const FRESHNESS_ADVICE = 'Choose dates the snapshot covers, or wait for a newer snapshot.';

/**
 * The `freshness` sentence, which is the ONE population check whose reason has two shapes.
 *
 * The reconciler fails it when the snapshot was generated before the period ended, when it
 * is dated after the Run started, and when the declaration states no readable time at all.
 * Generation 24 added `population_snapshot.generated_at` precisely so a surface can say
 * which; a sentence that only said "not fresh" would leave the reader to work out from a
 * cover sheet which direction they missed by.
 */
function freshnessSentence(facts: RunStopFacts): string {
  if (facts.snapshotGeneratedAt === null) return POPULATION_CHECK_WORDS.freshness;
  const generated = Date.parse(facts.snapshotGeneratedAt);
  if (Number.isNaN(generated)) return POPULATION_CHECK_WORDS.freshness;
  const generatedDay = facts.snapshotGeneratedAt.slice(0, 10);
  if (generated < Date.parse(`${facts.period.to}T23:59:59.999Z`)) {
    return `The source snapshot was generated on ${generatedDay}, before the period ended on ${facts.period.to}. ${FRESHNESS_ADVICE}`;
  }
  const started = Date.parse(facts.initiatedAt);
  if (!Number.isNaN(started) && generated > started) {
    return `The source snapshot is dated ${generatedDay}, after this Run started on ${facts.initiatedAt.slice(0, 10)}.`;
  }
  return POPULATION_CHECK_WORDS.freshness;
}

/**
 * The acquisition failures that are not checks: `population-<code>-failed`, one per
 * `AcquisitionFailureCode`, which is how `acquirePopulation` spells a terminal failure.
 */
export const POPULATION_FAILURE_WORDS: Readonly<Record<AcquisitionFailureCode, string>> = {
  transport: 'The Population Source could not be reached after every retry.',
  integrity: 'The Population Source bytes did not match their registered fingerprint.',
  contract: 'The Population Source answered in a shape this platform does not read.',
  denied: 'The Population Source refused the audit credential.',
  scope: 'The Population Source sent the Run outside its frozen scope.',
  credential: 'The Population Source echoed the audit credential, so its bytes were refused.',
};

/* ------------------------------------------------------------------ stages --- */

/**
 * The four stage vocabularies, each typed against the union the stage exports.
 *
 * The progress values (`workspace-created`, `session-established`, …) are in the unions
 * and so they are here: a checkpoint is only read as a stop when its status is terminal,
 * so they are never rendered, and the Record is complete because a partial one would let
 * the next stop diagnostic added to a stage fall through to the code-word sentence with
 * nothing failing.
 */
const LIMIT_WORDS = {
  'run-time-limit': 'The Run reached its time limit before it finished.',
  'run-step-execution-limit': 'The Run reached its limit of Step Executions before it finished.',
  'run-token-limit': 'The Run reached its model token limit before it finished.',
  'attempt-limit': 'A required step failed after every retry.',
  'unsupported-frozen-plan': 'This build cannot execute the plan this Procedure Version froze.',
  'credential-unresolved': 'No audit credential is configured for a Target System this Run needs.',
  canceled: 'A person canceled the Run.',
} as const;

export const WORKSPACE_WORDS: Readonly<Record<WorkspaceDiagnostic, string>> = {
  ...LIMIT_WORDS,
  'workspace-created': 'The Agent Workspace was created.',
  'workspace-reattached': 'The Agent Workspace was reattached.',
  'workspace-reattach-failed': 'The Agent Workspace could not be reattached, so a new one was made.',
  'workspace-release-failed': 'The old Agent Workspace could not be given back to the provider.',
  'workspace-released': 'The Agent Workspace was released.',
  'workspace-expired': 'The Agent Workspace expired at the provider before the Run could use it.',
  'workspace-unavailable': 'The Agent Workspace provider could not be reached after every retry.',
  'workspace-capacity': 'The Agent Workspace provider had no capacity after every retry.',
  'workspace-entitlement': 'The Agent Workspace provider refused: the plan does not allow this session.',
  'workspace-refused': 'The Agent Workspace provider refused the session.',
  'workspace-policy': 'A frozen origin could not be turned into a workspace policy.',
  'workspace-persistence-failed': 'The Agent Workspace opened, but the platform could not save its execution state. No audit conclusion was issued. Ask an administrator to check the worker and database before retrying.',
  'workspace-identity-invalid': 'The Agent Workspace provider returned an identity this platform cannot retain. Ask an administrator to check the provider integration before retrying.',
};

export const ACCESS_WORDS: Readonly<Record<AgentExecutionDiagnostic, string>> = {
  ...LIMIT_WORDS,
  'workspace-missing': 'No Agent Workspace was available for this Run.',
  'agent-execution-started': 'The agent started.',
  'sign-in-attempt-started': 'The sign-in started.',
  'session-established': 'The sign-in succeeded.',
  'agent-sign-in-complete': 'The sign-in completed.',
  'desktop-unsupported': 'A desktop Target System cannot be driven by a browser workspace in this release.',
  'sign-in-unavailable': 'The Target System sign-in page could not be reached after every retry.',
  'sign-in-contract-failed': 'The Target System sign-in page is not the form this platform expects.',
  'sign-in-denied': 'The Target System refused the sign-in.',
  'sign-in-scope-violation': 'The sign-in would have sent the credential outside the frozen origin.',
  'public-access-attempt-started': 'The public access check started.',
  'public-access-verified': 'The public page was verified.',
  'public-access-unavailable': 'The public Target System page could not be reached after every retry.',
  'public-access-denied': 'The Target System refused public access.',
  'public-access-scope-violation': 'The public page sent the Run outside its frozen scope.',
  'public-access-contract-failed': 'The public page is not the surface this Procedure Version froze.',
  'action-not-permitted': 'The agent asked for an action the registration does not permit.',
  'destination-refused': 'The agent asked for a destination outside the frozen origins.',
  'origin-not-allowed': 'The agent asked for a destination outside the frozen origins.',
  'parameter-out-of-scope': 'The agent asked for a value outside the frozen population.',
};

export const EXTRACTION_WORDS: Readonly<Record<AdapterExecutionDiagnostic, string>> = {
  ...LIMIT_WORDS,
  'agent-driven-target': 'This build cannot extract from an agent-driven Target System through the Adapter.',
  'unsupported-plan-version': 'This build cannot execute the plan version this Procedure Version froze.',
  'reference-transport-failed': 'A Reference Source could not be reached after every retry.',
  'reference-integrity-failed': 'A Reference Source did not match its registered fingerprint.',
  'reference-contract-failed': 'A Reference Source answered in a shape this platform does not read.',
  'reference-denied': 'A Reference Source refused the audit credential.',
  'reference-scope-violation': 'A Reference Source sent the Run outside its frozen scope.',
  'reference-credential-disclosed': 'A Reference Source echoed the audit credential, so its bytes were refused.',
  'extraction-transport-failed': 'A Target System could not be reached after every retry.',
  'extraction-integrity-failed': 'A Target System extraction did not match its registered fingerprint.',
  'extraction-contract-failed': 'A Target System answered in a shape this platform does not read.',
  'extraction-denied': 'A Target System refused the audit credential.',
  'extraction-scope-violation': 'A Target System sent the Run outside its frozen scope.',
  'extraction-credential-disclosed': 'A Target System echoed the audit credential, so its bytes were refused.',
  'observation-registration-refused': 'A batch of Observations was refused at registration.',
};

export const WORK_WORDS: Readonly<Record<AgentWorkDiagnostic, string>> = {
  ...LIMIT_WORDS,
  // Deliberately generic: the population is not always employees, and a sentence naming
  // one would be wrong on P-2, P-3 and P-4 (UI cleanup 2026-09-22, plan copy table).
  'population-key-unresolved':
    'A record’s reference is missing, or two records share one. Review the affected source records before running this test again.',
  'extraction-incomplete': 'An Adapter extraction this Run needs is not complete.',
  'prerequisites-incomplete': 'A stage this Run needs before inspection did not finish.',
  'workspace-missing': 'No Agent Workspace was available for this Run.',
  'model-not-configured': 'No model is configured for the agent on this deployment.',
  'model-invalid-action': 'The model proposed an action this platform refuses.',
  'model-no-proposal': 'The model proposed nothing this platform could act on.',
  'model-unavailable': 'The model provider could not be reached after every retry.',
  'model-timeout': 'The model provider did not answer in time after every retry.',
  'model-canceled': 'The model request was canceled.',
  'model-configuration': 'The model configuration this deployment holds was refused by the provider.',
  'model-invalid-request': 'The model provider refused the request.',
  'model-invalid-response': 'The model answered in a shape this platform refuses.',
  'model-policy-contradiction': 'The model contradicted the frozen policy, so its answer was refused.',
  'model-provider-refused': 'The model provider refused to answer.',
  'browser-unavailable': 'The Agent Workspace browser could not be reached after every retry.',
  'browser-denied': 'The Target System refused the agent.',
  'browser-scope-violation': 'The agent was sent outside the frozen origins.',
  'browser-contract-failed': 'The Target System page is not the surface this Procedure Version froze.',
  'capture-integrity-failed': 'A captured artifact did not match its registered fingerprint.',
  'capture-contract-failed': 'A captured artifact is not in the shape this platform stores.',
  'observation-registration-refused': 'A batch of Observations was refused at registration.',
  'human-decision-refused': 'A human decision on an Escalation was refused.',
  'unnamed-value': 'A Target System value is not one the Compliance Rule names.',
  'ambiguous-match': 'More than one record matched the lookup, and nobody chose one.',
  'insufficient-evidence': 'The agent found no safe next action and stopped.',
  'lost-claim': 'The worker lost its claim on this Run.',
};

/** The stage names a fallback sentence uses. In words, never the table name. */
/**
 * The stage names, as they read inside "the … stage". Read by `unknownStopSentence` and by
 * the Result tab's execution-failure panel, which names the stage beside the sentence.
 */
export const STAGE_WORDS: Readonly<Record<RunStopStage, string>> = {
  population: 'Population Source acquisition',
  workspace: 'Agent Workspace',
  access: 'Target System sign-in',
  extraction: 'Adapter extraction',
  work: 'agent inspection',
  wait: 'waiting for a person',
  unexecutable: 'dispatch',
};

/**
 * A wait whose deadline passed (Codex, PR 39).
 *
 * A pause nobody resumed and an Escalation nobody answered both end the Run
 * `INCONCLUSIVE` through `wakeEscalation`, with no stage checkpoint turning terminal and
 * no §H row written — so the reason lives on the wait row alone, and this is the one
 * place it becomes a sentence. The Escalation's own kind is named through the same words
 * the inbox and the Escalation panel use, never as its stored key.
 */
const WAIT_TIMEOUT_WORDS: Readonly<Record<WaitTimeoutDiagnostic, string>> = {
  'pause-timeout': 'The Run was paused and nobody resumed it before its deadline',
  'escalation-timeout': 'The agent asked a question and nobody answered it before its deadline',
};

function waitTimeoutSentence(facts: RunStopFacts, diagnostic: string): string {
  const opening = word(WAIT_TIMEOUT_WORDS, diagnostic);
  if (opening === null) return unknownStopSentence('wait', diagnostic);
  const wait = facts.timedOutWait;
  const question =
    diagnostic === 'escalation-timeout' && wait !== null && wait.kind !== 'pause'
      ? ` (${escalationKindWord(wait.kind)})`
      : '';
  // A readable instant, as every other time on the Run surfaces is: the Timeline's pause
  // history names this same deadline, and one page must not say it in two formats.
  const deadline = wait === null ? '' : ` of ${readableStamp(wait.deadline)}`;
  return `${opening}${question}${deadline}. No conclusion was issued.`;
}

/** The `Object.hasOwn` lookup, so a stored value that spells `constructor` gets the fallback. */
function word(table: Readonly<Record<string, string>>, key: string): string | null {
  return Object.hasOwn(table, key) ? table[key]! : null;
}

/**
 * The code-word fallback: which stage, and the exact code, so an operator can grep for it.
 *
 * Reached by a diagnostic this build does not know — a stage that gained one after this
 * module was written. It is honest about what is known and no more.
 */
export function unknownStopSentence(stage: RunStopStage, diagnostic: string): string {
  return `The Run stopped at the ${STAGE_WORDS[stage]} stage with the code "${diagnostic}".`;
}

/**
 * The population diagnostic is either the failed CHECK NAMES joined by `, ` — which is how
 * `acquirePopulation` records a reconciliation that did not pass — or one fixed value.
 */
function populationSentence(facts: RunStopFacts, diagnostic: string): string {
  const names = diagnostic.split(', ');
  if (names.every(isPopulationCheckName)) {
    return names
      .map((name) => (name === 'freshness' ? freshnessSentence(facts) : POPULATION_CHECK_WORDS[name]))
      .join(' ');
  }
  const failure = /^population-([a-z]+)-failed$/.exec(diagnostic)?.[1];
  const fixed = failure === undefined ? word(LIMIT_WORDS, diagnostic) : word(POPULATION_FAILURE_WORDS, failure);
  return fixed ?? unknownStopSentence('population', diagnostic);
}

const STAGE_TABLES: Readonly<Record<Exclude<RunStopStage, 'population' | 'wait' | 'unexecutable'>, Readonly<Record<string, string>>>> = {
  workspace: WORKSPACE_WORDS,
  access: ACCESS_WORDS,
  extraction: EXTRACTION_WORDS,
  work: WORK_WORDS,
};

function stageSentence(facts: RunStopFacts, stage: RunStopStage, diagnostic: string): string {
  if (stage === 'population') return populationSentence(facts, diagnostic);
  if (stage === 'wait') return waitTimeoutSentence(facts, diagnostic);
  if (stage === 'unexecutable') {
    return word(UNEXECUTABLE_RUN_REASONS, diagnostic) ?? unknownStopSentence(stage, diagnostic);
  }
  return word(STAGE_TABLES[stage], diagnostic) ?? unknownStopSentence(stage, diagnostic);
}

/* ------------------------------------------------------------------ result --- */

/** The Gate stopped it: the rows are on the Result tab, and this says how many. */
export function gateStopSentence(failed: number, checks: number): string {
  return `The Evidence Quality Gate did not pass: ${failed} of ${checks} checks failed. The Result tab lists them.`;
}

/** §E.1 row 5, by human rejection. The Gate passed; a person said no. */
export const REJECTED_EVALUATION_SENTENCE =
  'An Audit Manager rejected an Agent-Judged evaluation, so no conclusion was issued.';

/** Nothing recorded a reason. Said in words rather than shown as a blank. */
export const NO_RECORDED_REASON_SENTENCE =
  'The Run stopped before it concluded, and no stage recorded why.';

/**
 * Why this Run stopped, or `null` for a Run that has not stopped.
 *
 * `null` for every active state and for `COMPLETED`, which concluded; and for `CANCELED`,
 * whose banner already names the person and the time — a second sentence saying "a person
 * canceled it" would compete with the one that says who. Otherwise, in this order:
 *
 * 1. a stage checkpoint that ended the Run (population, workspace, sign-in, extraction,
 *    inspection), a wait whose deadline passed, or the chain's "this deployment cannot
 *    run it", in its own words;
 * 2. a Gate that ran and did not pass — the reason then IS the failed rows;
 * 3. a Gate that passed and a Result sealed Inconclusive by human rejection (§E.1 row 5);
 * 4. an honest sentence that nothing recorded why.
 *
 * A stage stop outranks the Gate on purpose: an agent Run that reaches its time limit
 * still records every §H row before sealing (2026-09-08), so both exist, and the limit is
 * what ended it.
 */
export function stopReason(facts: RunStopFacts): string | null {
  if (!isStoppedState(facts.state)) return null;
  if (facts.stop !== null) return stageSentence(facts, facts.stop.stage, facts.stop.diagnostic);
  if (facts.gateChecks > 0 && facts.gateFailed > 0) return gateStopSentence(facts.gateFailed, facts.gateChecks);
  if (facts.outcomeRow === 'unevaluated') return REJECTED_EVALUATION_SENTENCE;
  return NO_RECORDED_REASON_SENTENCE;
}

/** How many §H rows a complete Gate has, for callers that build a tally sentence. */
export const GATE_ROW_COUNT = GATE_CHECKS.length;
