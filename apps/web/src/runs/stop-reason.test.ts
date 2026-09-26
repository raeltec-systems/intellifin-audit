import { describe, expect, it } from 'vitest';

import { GATE_CHECKS, POPULATION_CHECK_NAMES, RUN_STATES } from '@intellifin/domain';
import { UNEXECUTABLE_RUN_REASONS } from '@intellifin/application';
import type { RunStopFacts } from '@intellifin/infrastructure';

import { readableStamp } from '../design/time';

import {
  ACCESS_WORDS,
  EXTRACTION_WORDS,
  FRESHNESS_ADVICE,
  NO_RECORDED_REASON_SENTENCE,
  POPULATION_CHECK_WORDS,
  POPULATION_FAILURE_WORDS,
  REJECTED_EVALUATION_SENTENCE,
  WORKSPACE_WORDS,
  WORK_WORDS,
  gateStopSentence,
  isStoppedState,
  stopReason,
  unknownStopSentence,
} from './stop-reason';

/**
 * Why a Run stopped, in words.
 *
 * The tables are typed against the stages' own unions, so a diagnostic added to a stage
 * without a sentence here does not compile; what these tests add is the RULE — which
 * facts win, which dates the freshness sentence reads, and what a value nobody transcribed
 * yet is shown as — because a table can be complete and the sentence still wrong.
 */

function facts(overrides: Partial<RunStopFacts> = {}): RunStopFacts {
  return {
    runId: '019823ab-0000-7000-8000-000000000001',
    state: 'INCONCLUSIVE',
    initiatedAt: '2026-09-15T10:00:00.000Z',
    period: { from: '2026-09-01', to: '2026-09-15' },
    stop: null,
    timedOutWait: null,
    snapshotGeneratedAt: null,
    gateChecks: 0,
    gateFailed: 0,
    outcomeRow: 'gate-failed',
    ...overrides,
  };
}

const stopped = (stage: NonNullable<RunStopFacts['stop']>['stage'], diagnostic: string, overrides: Partial<RunStopFacts> = {}): string | null =>
  stopReason(facts({ stop: { stage, diagnostic }, ...overrides }));

describe('which Runs get a stop sentence', () => {
  it('says nothing for a Run that has not stopped, concluded, or was canceled', () => {
    for (const state of RUN_STATES) {
      const expected = state === 'INCONCLUSIVE' || state === 'RUN_FAILED';
      expect(isStoppedState(state), state).toBe(expected);
      const sentence = stopReason(facts({ state, stop: { stage: 'population', diagnostic: 'freshness' } }));
      expect(sentence === null, state).toBe(!expected);
    }
  });
});

describe('the population sentences', () => {
  it('has a sentence for every check the reconciler can fail', () => {
    for (const name of POPULATION_CHECK_NAMES) {
      const sentence = POPULATION_CHECK_WORDS[name];
      expect(sentence, name).toMatch(/^[A-Z].*\.$/);
      // Never the code word itself: that is the defect the module exists to remove. A
      // plain English name (`declaration`, `generation`) may appear as a word; a
      // hyphenated one is only ever a code.
      if (name.includes('-')) expect(sentence, name).not.toContain(name);
    }
  });

  it('says a stale snapshot was generated BEFORE the period ended, with both dates and the advice', () => {
    // The production case: a snapshot generated on the first of the month, a Run over a
    // period that ends two weeks later. The Timeline said `freshness`.
    const sentence = stopped('population', 'freshness', { snapshotGeneratedAt: '2026-09-01T00:00:00.000Z' });
    expect(sentence).toBe(
      `The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15. ${FRESHNESS_ADVICE}`,
    );
  });

  it('says a snapshot dated AFTER the Run started is the other way it can be unfit', () => {
    const sentence = stopped('population', 'freshness', { snapshotGeneratedAt: '2026-09-20T00:00:00.000Z' });
    expect(sentence).toBe('The source snapshot is dated 2026-09-20, after this Run started on 2026-09-15.');
    expect(sentence).not.toContain(FRESHNESS_ADVICE);
  });

  it('falls back to the undeclared-time sentence when no generation time was stored', () => {
    expect(stopped('population', 'freshness')).toBe(POPULATION_CHECK_WORDS.freshness);
    expect(stopped('population', 'freshness', { snapshotGeneratedAt: 'not a date' })).toBe(POPULATION_CHECK_WORDS.freshness);
    // Generated after the period ended and before the Run started: the dates alone would
    // have passed, so the check failed on its other leg (the declaration and the response
    // disagreeing about the time) and the row gets the plain sentence, no invented date.
    expect(
      stopped('population', 'freshness', {
        snapshotGeneratedAt: '2026-09-16T00:00:00.000Z',
        initiatedAt: '2026-09-20T10:00:00.000Z',
      }),
    ).toBe(POPULATION_CHECK_WORDS.freshness);
  });

  it('joins every failed check, in the order the checkpoint recorded them', () => {
    expect(stopped('population', 'declared-count, freshness', { snapshotGeneratedAt: '2026-09-01T00:00:00.000Z' })).toBe(
      `${POPULATION_CHECK_WORDS['declared-count']} The source snapshot was generated on 2026-09-01, before the period ended on 2026-09-15. ${FRESHNESS_ADVICE}`,
    );
  });

  it('names the acquisition failures that are not checks', () => {
    expect(stopped('population', 'population-transport-failed')).toBe(POPULATION_FAILURE_WORDS.transport);
    expect(stopped('population', 'population-credential-failed')).toBe(POPULATION_FAILURE_WORDS.credential);
    expect(stopped('population', 'run-time-limit')).toBe('The Run reached its time limit before it finished.');
    expect(stopped('population', 'unsupported-frozen-plan')).toContain('cannot execute the plan');
  });

  it('shows a code nobody transcribed as the stage and the code, never as a blank', () => {
    expect(stopped('population', 'population-teleport-failed')).toBe(
      unknownStopSentence('population', 'population-teleport-failed'),
    );
    expect(unknownStopSentence('population', 'x-y')).toBe(
      'The Run stopped at the Population Source acquisition stage with the code "x-y".',
    );
    // A name the tables inherit from `Object.prototype` is not a diagnostic.
    expect(stopped('population', 'constructor')).toContain('"constructor"');
    expect(stopped('work', 'constructor')).toContain('agent inspection');
  });
});

describe('the stage sentences', () => {
  it('has a sentence ending in a full stop for every diagnostic of every stage', () => {
    for (const table of [WORKSPACE_WORDS, ACCESS_WORDS, EXTRACTION_WORDS, WORK_WORDS]) {
      for (const [diagnostic, sentence] of Object.entries(table)) {
        expect(sentence, diagnostic).toMatch(/^[A-Z].*\.$/);
      }
    }
  });

  it('reads each stage through its own table', () => {
    expect(stopped('workspace', 'workspace-refused')).toBe(WORKSPACE_WORDS['workspace-refused']);
    expect(stopped('access', 'sign-in-denied')).toBe(ACCESS_WORDS['sign-in-denied']);
    expect(stopped('extraction', 'reference-transport-failed')).toBe(EXTRACTION_WORDS['reference-transport-failed']);
    expect(stopped('work', 'model-unavailable')).toBe(WORK_WORDS['model-unavailable']);
    expect(stopped('extraction', 'sign-in-denied')).toBe(unknownStopSentence('extraction', 'sign-in-denied'));
  });

  // UI cleanup 2026-09-22 (plan copy table): the sentence says what to do, and stays
  // generic because the population is not always employees — P-2, P-3 and P-4 test
  // accounts, transactions and parameters. It used to say "A population record has no
  // usable lookup key", which names the mechanism and not the remedy.
  it('tells the reader what to do about an unresolved record key, in words true of every Template', () => {
    const sentence = stopped('work', 'population-key-unresolved');
    expect(sentence).toBe(
      'A record’s reference is missing, or two records share one. Review the affected source records before running this test again.',
    );
    expect(sentence).not.toMatch(/employee|leaver|lookup key/i);
  });

  it('says a pause nobody resumed, or a question nobody answered, ran out its deadline', () => {
    // Codex (PR 39): a timed-out wait ends the Run INCONCLUSIVE with no terminal stage
    // checkpoint and no §H row, so the first version fell through to "nothing recorded why"
    // for the one stop whose record is the most explicit of all.
    // The deadline is a readable instant, never a raw ISO string (screenshot review,
    // 2026-09-26): the Timeline's pause history names the same deadline in words.
    const paused = stopped('wait', 'pause-timeout', { timedOutWait: { kind: 'pause', deadline: '2026-09-16T07:30:00.000Z' } });
    expect(paused).toBe('The Run was paused and nobody resumed it before its deadline of 16 Sep 2026, 07:30:00 UTC. No conclusion was issued.');
    expect(paused).toBe(`The Run was paused and nobody resumed it before its deadline of ${readableStamp('2026-09-16T07:30:00.000Z')}. No conclusion was issued.`);
    const escalation = stopped('wait', 'escalation-timeout', {
      timedOutWait: { kind: 'choose-candidate', deadline: '2026-09-16T11:00:00.000Z' },
    });
    expect(escalation).toBe(
      'The agent asked a question and nobody answered it before its deadline (Choose candidate) of 16 Sep 2026, 11:00:00 UTC. No conclusion was issued.',
    );
    expect(escalation).not.toContain('T11:00');
    // The stored kind is never printed as its key.
    expect(escalation).not.toContain('choose-candidate');
    // A wait row this reader could not fully read still gets the sentence, without a date.
    expect(stopped('wait', 'escalation-timeout')).toBe(
      'The agent asked a question and nobody answered it before its deadline. No conclusion was issued.',
    );
    expect(stopped('wait', 'something-new')).toBe(unknownStopSentence('wait', 'something-new'));
    expect(unknownStopSentence('wait', 'x')).toContain('waiting for a person');
  });

  it("uses the application's own sentence for a Run this deployment could not run", () => {
    expect(stopped('unexecutable', 'evidence-store-unconfigured', { state: 'RUN_FAILED' })).toBe(
      UNEXECUTABLE_RUN_REASONS['evidence-store-unconfigured'],
    );
    expect(stopped('unexecutable', 'something-else', { state: 'RUN_FAILED' })).toBe(
      unknownStopSentence('unexecutable', 'something-else'),
    );
  });
});

describe('what wins', () => {
  it('lets a stage stop outrank the Gate, because an exhausted agent Run still records every §H row', () => {
    const sentence = stopped('work', 'run-time-limit', { gateChecks: GATE_CHECKS.length, gateFailed: 3 });
    expect(sentence).toBe('The Run reached its time limit before it finished.');
  });

  it('names the Gate when no stage stopped the Run and the Gate did not pass', () => {
    expect(stopReason(facts({ gateChecks: GATE_CHECKS.length, gateFailed: 2 }))).toBe(
      gateStopSentence(2, GATE_CHECKS.length),
    );
    expect(gateStopSentence(2, 20)).toBe(
      'The Evidence Quality Gate did not pass: 2 of 20 checks failed. The Result tab lists them.',
    );
  });

  it('names the human rejection when the Gate passed and §E.1 row 5 sealed the Result', () => {
    expect(stopReason(facts({ gateChecks: GATE_CHECKS.length, gateFailed: 0, outcomeRow: 'unevaluated' }))).toBe(
      REJECTED_EVALUATION_SENTENCE,
    );
  });

  it('says in words that nothing recorded a reason, rather than showing a blank', () => {
    expect(stopReason(facts({ state: 'RUN_FAILED', outcomeRow: 'run-failed' }))).toBe(NO_RECORDED_REASON_SENTENCE);
    expect(stopReason(facts({ gateChecks: GATE_CHECKS.length, gateFailed: 0, outcomeRow: null }))).toBe(
      NO_RECORDED_REASON_SENTENCE,
    );
  });
});
