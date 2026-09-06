import { describe, expect, it } from 'vitest';

import { GATE_CHECKS, RUN_STATES, SYSTEM_OUTCOMES, WORK_ITEM_STATES } from '@intellifin/domain';

import { STATUS_VOCABULARY } from '../design/status';
import {
  countText,
  durationText,
  elapsedText,
  evaluationOriginWord,
  evaluationValueWord,
  gateWord,
  inspectableSubstrate,
  periodText,
  resultOutcomeWord,
  runLifecycleWord,
  sessionStepWord,
  utcStamp,
  wordFor,
  workItemWord,
} from './labels';

/**
 * The words this surface writes.
 *
 * `StatusBadge` THROWS on a state its family does not hold, and on a server-rendered page
 * that is a 500 for the whole Run — so every value read out of a database row must reach
 * a badge only through a guarded lookup, and a value the vocabulary does not hold must
 * come back as `null` so the caller can write it in words. That is what these test.
 *
 * The words themselves are checked against `STATUS_VOCABULARY`, which `status.test.ts`
 * checks against DESIGN.md's table on disk — so a word here that no family holds fails,
 * rather than being compared with a copy of itself.
 */

const states = <F extends keyof typeof STATUS_VOCABULARY>(family: F): readonly string[] =>
  Object.keys(STATUS_VOCABULARY[family].states);

describe('badge words are always in their family', () => {
  it('maps every stored Run state onto a run-lifecycle state', () => {
    for (const state of RUN_STATES) {
      const word = runLifecycleWord(state);
      expect(word, state).not.toBeNull();
      expect(states('run-lifecycle')).toContain(word);
    }
  });

  it('maps every System Outcome, and a missing Result, onto a result-outcome state', () => {
    for (const outcome of SYSTEM_OUTCOMES) {
      const word = resultOutcomeWord(outcome);
      expect(word, outcome).not.toBeNull();
      expect(states('result-outcome')).toContain(word);
    }
    // No Result row is a FACT — nothing has been published, so no conclusion has been
    // issued — and not a placeholder. It is the opposite of "Active version: Draft".
    expect(resultOutcomeWord(null)).toBe('No conclusion issued');
  });

  it('maps every stored Work Item state onto a work-item state', () => {
    for (const state of WORK_ITEM_STATES) {
      const word = workItemWord(state);
      expect(word, state).not.toBeNull();
      expect(states('work-item')).toContain(word);
    }
  });

  it('maps every evaluation origin and value onto its family', () => {
    expect(evaluationOriginWord('RULE', null)).toBe('Rule-Classified');
    expect(evaluationOriginWord('HUMAN', null)).toBe('Human-classified');
    // DESIGN.md gives pending and confirmed two different treatments — the pending one is
    // the "needs a human" solid blue — so reading them as one loses the distinction.
    expect(evaluationOriginWord('AGENT_JUDGED', 'pending')).toBe('Agent-Judged (pending)');
    expect(evaluationOriginWord('AGENT_JUDGED', 'confirmed')).toBe('Agent-Judged (confirmed)');
    expect(evaluationOriginWord('AGENT_JUDGED', 'rejected')).toBeNull();
    for (const value of ['COMPLIANT', 'EXCEPTION', 'UNEVALUATED'] as const) {
      expect(states('evaluation-value')).toContain(evaluationValueWord(value));
    }
  });

  it('returns null for a value outside the vocabulary rather than a wrong badge', () => {
    expect(runLifecycleWord('SOMETHING_ELSE')).toBeNull();
    expect(workItemWord('SOMETHING_ELSE')).toBeNull();
    expect(resultOutcomeWord('SOMETHING_ELSE' as never)).toBeNull();
  });

  it('guards every lookup keyed by a stored value', () => {
    // `Object.hasOwn`: a plain index on `'constructor'` answers with an inherited
    // function, and every one of these keys comes out of a database row.
    for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(runLifecycleWord(hostile), hostile).toBeNull();
      expect(workItemWord(hostile), hostile).toBeNull();
      expect(resultOutcomeWord(hostile as never), hostile).toBeNull();
      expect(typeof sessionStepWord(hostile)).toBe('string');
      expect(sessionStepWord(hostile)).toBe(hostile);
    }
  });

  it('falls back to the stored value itself, never to a guess or an empty cell', () => {
    expect(wordFor({ A: 'Alpha' }, 'A')).toBe('Alpha');
    expect(wordFor({ A: 'Alpha' }, 'Z')).toBe('Z');
    expect(wordFor({}, 'constructor')).toBe('constructor');
  });
});

describe('the Evidence Quality Gate word', () => {
  it('says "Not evaluated" when no §H row exists, never "Passed"', () => {
    // An unrun Gate is not a passed Gate: the same fail-closed reading
    // `OutcomeFacts.gatePassed` takes. A Run canceled while queued is exactly this case.
    expect(gateWord(0, 0)).toBe('Not evaluated');
  });

  it('says "Incomplete" for a partial set of rows', () => {
    expect(gateWord(GATE_CHECKS.length - 1, 0)).toBe('Incomplete');
    expect(gateWord(1, 0)).toBe('Incomplete');
  });

  it('says "Passed" only for a complete set with no failure', () => {
    expect(gateWord(GATE_CHECKS.length, 0)).toBe('Passed');
    expect(gateWord(GATE_CHECKS.length, 1)).toBe('Not passed');
  });

  it('uses a word from the Evidence Quality Gate family every time', () => {
    for (const [checks, failed] of [[0, 0], [5, 0], [20, 0], [20, 3]] as const) {
      expect(states('evidence-quality-gate')).toContain(gateWord(checks, failed));
    }
  });
});

describe('the contract formats', () => {
  it('writes a timestamp as ISO 8601 in UTC with Z', () => {
    expect(utcStamp('2026-09-06T09:00:00.000Z')).toBe('2026-09-06T09:00:00.000Z');
    expect(utcStamp(new Date('2026-09-06T09:00:00Z'))).toBe('2026-09-06T09:00:00.000Z');
    // A value that is not a date is shown as it was stored rather than as "Invalid Date".
    expect(utcStamp('not a date')).toBe('not a date');
  });

  it('writes a period as `from → to`', () => {
    expect(periodText({ from: '2026-08-25', to: '2026-08-31' })).toBe('2026-08-25 → 2026-08-31');
  });

  it('writes a duration as `3m 41s`', () => {
    expect(durationText(221_000)).toBe('3m 41s');
    expect(durationText(0)).toBe('0s');
    expect(durationText(3_723_000)).toBe('1h 2m 3s');
    expect(durationText(-1)).toBe('0s');
    expect(durationText(Number.NaN)).toBe('0s');
  });

  it('writes counts with thousands separators', () => {
    expect(countText(1842)).toBe('1,842');
    expect(countText(0)).toBe('0');
  });

  it('measures elapsed to the sealed Result, or to the instant the page was read', () => {
    const initiated = '2026-09-06T09:00:00.000Z';
    expect(elapsedText(initiated, '2026-09-06T09:03:41.000Z', new Date('2026-09-06T10:00:00Z'))).toBe('3m 41s');
    expect(elapsedText(initiated, null, new Date('2026-09-06T09:00:30Z'))).toBe('30s');
    expect(elapsedText('not a date', null, new Date())).toBe('0s');
  });
});

describe('which snapshots the grounding inspector can open', () => {
  it('asks the domain, and accepts only the two substrates the extractor re-reads', () => {
    expect(inspectableSubstrate('text/csv')).toBe('sheet');
    expect(inspectableSubstrate('application/json')).toBe('json');
    expect(inspectableSubstrate('application/json; charset=utf-8')).toBe('json');
    // `web_tree` and `desktop_tree` are refused BY NAME by the extractor, so an inspector
    // that opened for them would promise a re-read nothing performed.
    expect(inspectableSubstrate('text/html')).toBeNull();
    expect(inspectableSubstrate(null)).toBeNull();
  });
});
