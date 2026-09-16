import { describe, expect, it } from 'vitest';

import { ACTIVE_RUN_STATES, POPULATION_CHECK_NAMES, RUN_STATES } from '@intellifin/domain';

import {
  NO_STEP_EXECUTIONS_ENDED_SENTENCE,
  NO_STEP_EXECUTIONS_PENDING_SENTENCE,
  POPULATION_CHECKS_RAN_SENTENCE,
  POPULATION_ENDED_BEFORE_CHECKS_SENTENCE,
  POPULATION_IN_PROGRESS_SENTENCE,
  POPULATION_PENDING_SENTENCE,
  POPULATION_STOPPED_SENTENCE,
  indeterminateRowsSentence,
  populationCheckSentence,
  populationCheckTitle,
  populationDiagnosticSentence,
  populationProgressSentence,
  populationStatusWord,
  stepExecutionsSentence,
  workspaceDiagnosticSentence,
  workspaceStatusWord,
} from './stage-words';
import { POPULATION_CHECK_WORDS } from './stop-reason';

/**
 * The two session-preparation stages, in words (owner review, 2026-09-16).
 *
 * Every case here is a sentence a production Run said wrongly or did not say at all: a
 * verified population whose target checks were "pending" on a Run that had ended, four
 * unplaceable rows nothing explained, `0 of 0 Step Executions`, and a stage row whose
 * status and diagnostic were both raw stored codes.
 */

const TERMINAL_STATES = RUN_STATES.filter((state) => !(ACTIVE_RUN_STATES as readonly string[]).includes(state));

describe('what the population stage means for this Run', () => {
  it('says target checks are pending only while the Run is still active', () => {
    for (const state of ACTIVE_RUN_STATES) {
      expect(populationProgressSentence({ status: 'POPULATION_READY', runState: state, observations: 0 }))
        .toBe(POPULATION_PENDING_SENTENCE);
    }
  });

  it('says a stopped Run ended before any target check ran, rather than promising one', () => {
    // The owner's production Run: population acquired, no Step Execution, no Observation,
    // Run Failed. "Target checks are pending" describes a future this Run does not have.
    for (const state of ['RUN_FAILED', 'INCONCLUSIVE', 'CANCELED']) {
      expect(populationProgressSentence({ status: 'POPULATION_READY', runState: state, observations: 0 }))
        .toBe(POPULATION_ENDED_BEFORE_CHECKS_SENTENCE);
    }
    expect(POPULATION_ENDED_BEFORE_CHECKS_SENTENCE).not.toContain('pending');
  });

  it('does not claim a Run that tested records ended before any check ran', () => {
    // An Inconclusive Run that produced Observations DID run target checks; only its
    // conclusion is unsupported. Saying otherwise would understate what it did.
    expect(populationProgressSentence({ status: 'POPULATION_READY', runState: 'INCONCLUSIVE', observations: 12 }))
      .toBe(POPULATION_CHECKS_RAN_SENTENCE);
  });

  it('says a Completed Run ran its target checks whatever the Observation count', () => {
    expect(populationProgressSentence({ status: 'POPULATION_READY', runState: 'COMPLETED', observations: 0 }))
      .toBe(POPULATION_CHECKS_RAN_SENTENCE);
  });

  it('reads the STAGE first: an acquisition that stopped or is still running says so', () => {
    for (const state of RUN_STATES) {
      expect(populationProgressSentence({ status: 'TERMINAL', runState: state, observations: 0 }))
        .toBe(POPULATION_STOPPED_SENTENCE);
      for (const status of ['ACQUIRING', 'RETRY']) {
        expect(populationProgressSentence({ status, runState: state, observations: 0 }))
          .toBe(POPULATION_IN_PROGRESS_SENTENCE);
      }
    }
  });

  it('gives every Run state a sentence, and never an empty one', () => {
    for (const state of RUN_STATES) {
      const sentence = populationProgressSentence({ status: 'POPULATION_READY', runState: state, observations: 0 });
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).not.toContain(state);
    }
  });
});

describe('the rows the inclusion rule could not place', () => {
  it('says how many, in what state, and what they cost at the Gate', () => {
    const sentence = indeterminateRowsSentence(4);
    expect(sentence).toContain('4 rows');
    // The placement words are the domain's own check sentence, not a second copy of it.
    expect(sentence).toContain(POPULATION_CHECK_WORDS['complete-inclusion']);
    expect(sentence).toContain('unaccounted row at the Evidence Quality Gate');
  });

  it('groups a large count the way every other count on these surfaces is grouped', () => {
    expect(indeterminateRowsSentence(12_000)).toContain('12,000 rows');
  });
});

describe('the population checks, in words', () => {
  it('has an affirmative title and a failure sentence for every check the domain names', () => {
    for (const name of POPULATION_CHECK_NAMES) {
      const title = populationCheckTitle(name);
      expect(title).not.toBeNull();
      expect(populationCheckSentence(name)).toBe(POPULATION_CHECK_WORDS[name]);
      // The title is what the check CLAIMS, so `<title>: Passed` reads correctly. The
      // failure sentence beside `Passed` would state the opposite of its own row.
      expect(title).not.toBe(POPULATION_CHECK_WORDS[name]);
    }
  });

  it('answers nothing for a stored value the vocabulary does not hold', () => {
    // A jsonb column is stored input: `constructor` must not return a function from the
    // prototype, and a name nobody transcribed yet must not render as a blank.
    expect(populationCheckTitle('constructor')).toBeNull();
    expect(populationCheckSentence('toString')).toBeNull();
    expect(populationCheckTitle('some-check-a-later-build-added')).toBeNull();
  });
});

describe('the stage rows on the Execution Timeline', () => {
  it('writes every stored status as a word, and a RELEASED workspace is not a failure', () => {
    for (const status of ['PROVISIONING', 'OPEN', 'RETRY', 'RELEASED', 'FAILED']) {
      expect(workspaceStatusWord(status)).not.toBe(status);
    }
    expect(workspaceStatusWord('FAILED')).toBe('Failed');
    // A RELEASED workspace is the ordinary end of a Run that used one — the worker gives a
    // healthy one back in its `finally` — so its word must not read as a failure.
    expect(workspaceStatusWord('RELEASED')).toBe('Released');
    for (const status of ['ACQUIRING', 'RETRY', 'POPULATION_READY', 'TERMINAL']) {
      expect(populationStatusWord(status)).not.toBe(status);
    }
    expect(populationStatusWord('POPULATION_READY')).toBe('Acquired');
    expect(populationStatusWord('TERMINAL')).toBe('Stopped');
  });

  it('shows a status this build does not know as it was stored, rather than as nothing', () => {
    expect(workspaceStatusWord('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(populationStatusWord('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('turns a workspace diagnostic into the stage’s own sentence', () => {
    expect(workspaceDiagnosticSentence('workspace-refused'))
      .toBe('The Agent Workspace provider refused the session.');
    expect(workspaceDiagnosticSentence(null)).toBeNull();
    // Unknown answers `null` so the caller still shows the stored code rather than a
    // sentence this build invented for it.
    expect(workspaceDiagnosticSentence('workspace-something-new')).toBeNull();
  });

  it('turns a population diagnostic into words in all three shapes the stage writes it', () => {
    expect(populationDiagnosticSentence('complete-inclusion'))
      .toBe(POPULATION_CHECK_WORDS['complete-inclusion']);
    expect(populationDiagnosticSentence('declared-count, declared-digest'))
      .toBe(`${POPULATION_CHECK_WORDS['declared-count']} ${POPULATION_CHECK_WORDS['declared-digest']}`);
    expect(populationDiagnosticSentence('population-transport-failed'))
      .toBe('The Population Source could not be reached after every retry.');
    // The Run-limit vocabulary every stage shares.
    expect(populationDiagnosticSentence('run-time-limit'))
      .toBe('The Run reached its time limit before it finished.');
    expect(populationDiagnosticSentence(null)).toBeNull();
    expect(populationDiagnosticSentence('population-something-failed')).toBeNull();
  });
});

describe('the Execution Timeline’s headline', () => {
  it('says no record was tested, and why, instead of counting zero of zero', () => {
    for (const state of TERMINAL_STATES) {
      const sentence = stepExecutionsSentence(0, 0, state);
      expect(sentence).toBe(NO_STEP_EXECUTIONS_ENDED_SENTENCE);
      expect(sentence).not.toContain('0 of 0');
    }
    expect(NO_STEP_EXECUTIONS_ENDED_SENTENCE).toContain('no record was tested');
    // It must NOT name a preparation stage. A Run that signed in and then stopped has no
    // Step Execution either, and a sentence claiming it ended while creating its workspace
    // contradicts the stage rows directly above it (Codex, PR 40). The rows own that fact.
    expect(NO_STEP_EXECUTIONS_ENDED_SENTENCE).not.toContain('Agent Workspace');
    expect(NO_STEP_EXECUTIONS_ENDED_SENTENCE).not.toContain('acquiring the population');
    expect(NO_STEP_EXECUTIONS_ENDED_SENTENCE).toContain('stage rows above');
  });

  it('does not tell an active Run that it ended', () => {
    for (const state of ACTIVE_RUN_STATES) {
      expect(stepExecutionsSentence(0, 0, state)).toBe(NO_STEP_EXECUTIONS_PENDING_SENTENCE);
    }
    expect(NO_STEP_EXECUTIONS_PENDING_SENTENCE).not.toContain('ended');
    expect(NO_STEP_EXECUTIONS_PENDING_SENTENCE).not.toContain('Agent Workspace');
    expect(NO_STEP_EXECUTIONS_PENDING_SENTENCE).toContain('stage rows above');
  });

  it('counts the listed Step Executions when there are any, whatever the Run state', () => {
    for (const state of RUN_STATES) {
      const sentence = stepExecutionsSentence(50, 1200, state);
      expect(sentence).toContain('50 of 1,200 Step Executions are listed');
      expect(sentence).toContain('a unit with a failure is expanded');
    }
  });
});
