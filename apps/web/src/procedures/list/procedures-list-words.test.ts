import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROCEDURE_VERSION_STATES } from '@intellifin/domain';

import { PROCEDURE_CARD_ABSENT } from '../../design/copy';
import {
  FILTER_KEYS,
  PLANNED_NOT_SCHEDULED_SUFFIX,
  PROCEDURES_EMPTY,
  PROCEDURES_LEDE,
  PROCEDURES_NO_MATCH,
  STATE_FILTER_WORDS,
  matchedSentence,
  pageSentence,
  plannedFrequencySentence,
  scheduleNoteHint,
} from './procedures-list-words';

/**
 * The Procedures list's sentences (UI cleanup 2026-09-22, UX-03 and UX-04).
 *
 * The `run-start-words.ts` rule. What is pinned here is the platform's own wording and
 * the two rules the owner's findings were about: a filtered list counts EXACTLY, and the
 * scheduler's absence is stated once rather than on every card.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('the Procedures list words', () => {
  it('says a frozen frequency is a PLAN and never a promise', () => {
    // EXPERIENCE.md: "Frequency is a planned frequency until a scheduler exists. Saving a
    // frequency never implies automatic execution."
    expect(plannedFrequencySentence('weekly')).toBe('Planned: weekly · not scheduled by the platform');
    expect(PLANNED_NOT_SCHEDULED_SUFFIX).toContain('not scheduled');
  });

  it('takes the contract\'s absent sentence rather than restating it', () => {
    // `PROCEDURE_CARD_ABSENT` is pinned against EXPERIENCE.md by `copy.test.ts`; a copy
    // here would be the retyped-sentence defect in the module that exists to prevent it.
    expect(scheduleNoteHint(PROCEDURE_CARD_ABSENT.schedule)).toContain(PROCEDURE_CARD_ABSENT.schedule);
    // Comments stripped first: this module's own doc comment NAMES the contract sentence
    // to explain why it is not restated, and a scan over prose would fail on that.
    const code = read('./procedures-list-words.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('Not scheduled');
  });

  it('counts exactly, and says so differently when a filter is narrowing', () => {
    // Both numbers come from their own `count(*)`. A list that said "20 Procedures"
    // because twenty is what fits would be the bound wearing a count's clothes.
    expect(matchedSentence(7, 7)).toBe('7 Procedures.');
    expect(matchedSentence(1, 1)).toBe('1 Procedure.');
    expect(matchedSentence(3, 42)).toBe('3 Procedures of 42.');
    expect(matchedSentence(1, 42)).toBe('1 Procedure of 42.');
    // Thousands separators, per EXPERIENCE.md's Counts format.
    expect(matchedSentence(1200, 4000)).toBe('1,200 Procedures of 4,000.');
    expect(pageSentence(21, 40, 1234)).toBe('Showing 21–40 of 1,234.');
  });

  it('tells an empty deployment apart from a filter that matched nothing', () => {
    // Two different statements about the environment, and the second must not read as the
    // first: the reader narrowed the list themselves and the remedy is theirs.
    expect(PROCEDURES_EMPTY.headline).not.toBe(PROCEDURES_NO_MATCH.headline);
    expect(PROCEDURES_NO_MATCH.sentence).toContain('clear the filters');
    for (const state of [PROCEDURES_EMPTY, PROCEDURES_NO_MATCH]) {
      expect(state.sentence.length).toBeGreaterThan(40);
      expect(state.sentence).toContain('does not mean a control passed');
    }
  });

  it('offers every version state the domain has, and nothing it does not', () => {
    // Typed against the domain's own union, so a state added there fails to COMPILE
    // rather than becoming unfilterable in silence.
    expect(Object.keys(STATE_FILTER_WORDS).sort()).toEqual([...PROCEDURE_VERSION_STATES].sort());
  });

  it('names the query-string keys once, so the form and the page cannot come apart', () => {
    const form = read('./ProcedureFilters.tsx');
    const page = read('../../../app/procedures/page.tsx');
    for (const key of Object.values(FILTER_KEYS)) {
      // Neither file may spell a key as a literal: both read it from here.
      expect(form, key).not.toContain(`name="${key}"`);
      expect(page, key).not.toContain(`'${key}'`);
    }
    expect(form).toContain('FILTER_KEYS');
    expect(page).toContain('FILTER_KEYS');
  });

  it('is rendered from this module by the list, never retyped', () => {
    const page = read('../../../app/procedures/page.tsx');
    expect(page).toContain('PROCEDURES_LEDE');
    expect(page).not.toContain(PROCEDURES_LEDE);
    // The filter form mutates nothing and says so on the tag, which is the ONE exception
    // `form-method.test.ts` admits to the POST rule.
    expect(read('./ProcedureFilters.tsx')).toContain('data-readonly-filter="true"');
  });
});
