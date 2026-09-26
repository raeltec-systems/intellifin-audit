import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunHumanMatch } from '@intellifin/infrastructure';

import { HumanMatchNote, NO_HUMAN_MATCHES, humanMatchFor, humanMatchesForRecord, type HumanMatchIndex } from './HumanMatch';
import { referenceLabel } from '../design/references';
import { matchOriginWord } from './labels';
import { MATCH_DECISION_WORDS, choseCandidateWords, humanMatchesBoundedWords } from './match-words';

/**
 * A record a PERSON matched, said where the record is shown (Story 10.6, legacy 4.7).
 *
 * Every sentence asserted here is READ from `match-words.ts`, never retyped, so the
 * component and this test cannot drift apart from the words the browser spec reads too.
 */

const RUN_OBSERVATION = '019823ab-0000-7000-8000-0000000000a1';
const OTHER_OBSERVATION = '019823ab-0000-7000-8000-0000000000a2';
const WAIT_ID = '019823ab-0000-7000-8000-0000000000b1';
const AUDITOR = '019823ab-0000-7000-8000-0000000000c1';
const DECIDED_AT = '2026-09-26T10:14:07.000Z';

function linked(overrides: Partial<Extract<RunHumanMatch['decision'], { state: 'linked' }>> = {}): RunHumanMatch {
  return {
    observationId: RUN_OBSERVATION,
    targetSystem: 'loancore',
    populationRecordKey: 'E-000102',
    decision: {
      state: 'linked',
      waitId: WAIT_ID,
      candidate: 2,
      candidates: 3,
      candidateLabel: 'Ada Musonda <script>alert(1)</script>',
      decidedBy: AUDITOR,
      decidedAt: DECIDED_AT,
      ...overrides,
    },
  };
}

const notLinked: RunHumanMatch = {
  observationId: OTHER_OBSERVATION,
  targetSystem: 'loancore',
  populationRecordKey: 'E-000105',
  decision: { state: 'not-linked' },
};

const names = new Map([[AUDITOR, 'Dana Reed']]);

const note = (props: Parameters<typeof HumanMatchNote>[0]): string =>
  renderToStaticMarkup(React.createElement(HumanMatchNote, props));

/** The note's visible text, tags removed, so a sentence can be compared as a reader reads it. */
const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

describe('the human-selected match, said where the record is (Story 10.6, legacy 4.7)', () => {
  it('flags a linked match with the existing word, and traces it to who chose which candidate, when, and why', () => {
    const html = note({ match: linked(), names });
    // The flag is the SAME word the Evidence cards print for this match origin.
    expect(MATCH_DECISION_WORDS.flag).toBe(matchOriginWord('human-matched'));
    expect(html).toContain(`<strong class="ls-human-match__flag">${MATCH_DECISION_WORDS.flag}</strong>`);
    // Who chose, which candidate among how many, when (a machine-readable instant), and
    // the Escalation that asked — the answered wait, by a short reference.
    expect(text(html)).toContain(`Dana Reed ${choseCandidateWords(2, 3)} on`);
    expect(html).toContain(`dateTime="${DECIDED_AT}"`);
    expect(text(html)).toContain(referenceLabel('Escalation', WAIT_ID));
    expect(html).toContain(`title="${WAIT_ID}"`);
    expect(html).toContain('data-human-match="linked"');
    expect(html).not.toContain(MATCH_DECISION_WORDS.notLinked);
    // The compact line carries no untrusted text: the candidate's own words are detail.
    expect(html).not.toContain('Ada Musonda');
  });

  it('shows the flag and says the decision is not linked, rather than guessing one', () => {
    const html = note({ match: notLinked, names });
    expect(html).toContain(`<strong class="ls-human-match__flag">${MATCH_DECISION_WORDS.flag}</strong>`);
    expect(text(html)).toContain(MATCH_DECISION_WORDS.notLinked);
    expect(html).toContain('data-human-match="not-linked"');
    // No person, no time, no reference: nothing that could read as the decision.
    expect(html).not.toContain('<time');
    expect(html).not.toContain('Escalation ');
    expect(html).not.toContain('Dana Reed');
  });

  it('says what an unlinked decision means and names no cause, because there is more than one', () => {
    for (const cause of ['before', 'older', 'earlier', 'build', 'migration']) {
      expect(MATCH_DECISION_WORDS.notLinked).not.toContain(cause);
    }
  });

  it('adds the candidate’s own text, inert under its source label, and the wait under Technical details', () => {
    const html = note({ match: linked(), names, detail: true });
    expect(html).toContain(`Untrusted source content — ${MATCH_DECISION_WORDS.candidateField}.`);
    // The Audit Agent wrote the label: it is escaped text, never markup.
    expect(html).toContain('Ada Musonda &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    // The policy sentence is the SURFACE's to say once (UX-27), not each note's.
    expect(html).not.toContain('ls-untrusted-region__policy');
    expect(html).toContain(MATCH_DECISION_WORDS.waitIdentifier);
    expect(html).toContain(WAIT_ID);
  });

  it('adds nothing to an unlinked match in detail, where there is no decision to show', () => {
    const html = note({ match: notLinked, names, detail: true });
    expect(html).not.toContain('Untrusted source content');
    expect(html).not.toContain(MATCH_DECISION_WORDS.waitIdentifier);
  });

  it('shows the person’s id when no name is known, never a blank', () => {
    const html = note({ match: linked(), names: new Map() });
    expect(html).toContain(`<span class="ls-mono">${AUDITOR}</span>`);
  });

  it('names the system first when a surface lists more than one', () => {
    expect(text(note({ match: linked(), names, prefix: 'LoanCore' }))).toMatch(/^LoanCore: Human-matched · /);
    expect(text(note({ match: linked(), names }))).toMatch(/^Human-matched · /);
  });

  it('finds a match by Observation, and a platform match (absent from the index) is none', () => {
    const index: HumanMatchIndex = { matches: [linked(), notLinked], names };
    expect(humanMatchFor(index, RUN_OBSERVATION)?.decision.state).toBe('linked');
    expect(humanMatchFor(index, OTHER_OBSERVATION)?.decision.state).toBe('not-linked');
    expect(humanMatchFor(index, '019823ab-0000-7000-8000-0000000000ff')).toBeNull();
    expect(humanMatchFor(index, null)).toBeNull();
    expect(humanMatchFor(NO_HUMAN_MATCHES, RUN_OBSERVATION)).toBeNull();
  });

  it('finds a record’s matches by the system AND the key the Result names it by', () => {
    const index: HumanMatchIndex = { matches: [linked(), notLinked], names };
    expect(humanMatchesForRecord(index, 'loancore', 'E-000102').map((match) => match.observationId)).toEqual([RUN_OBSERVATION]);
    expect(humanMatchesForRecord(index, 'accessgate', 'E-000102')).toEqual([]);
    expect(humanMatchesForRecord(index, 'loancore', 'E-000999')).toEqual([]);
  });

  it('counts candidates and the bounded list in grouped digits', () => {
    expect(choseCandidateWords(1234, 5678)).toContain('1,234');
    expect(choseCandidateWords(1234, 5678)).toContain('5,678');
    expect(humanMatchesBoundedWords(100, 1234)).toContain('1,234');
    expect(humanMatchesBoundedWords(100, 1234)).not.toContain('1234');
  });
});
