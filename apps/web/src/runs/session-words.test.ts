import { describe, expect, it } from 'vitest';

import { PERMITTED_READ_ACTIONS, RUN_STATES } from '@intellifin/domain';

import {
  NO_WORK_ITEM,
  attemptContext,
  noWorkItemSentence,
  planActionNarration,
  recordFramePosition,
  toolActionNarration,
} from './session-words';

/**
 * The narration vocabulary is pinned here rather than inside a component, for the
 * `run-start-words.ts` reason: a sentence retyped in a test is a sentence pinned against
 * nothing, and the browser specs read these same constants.
 */
describe('narrating an audit action (UI cleanup 2026-09-22, UX-28)', () => {
  const on = { subject: 'E-000103', system: 'LoanCore' } as const;

  it('says the two sentences EXPERIENCE.md names, from the action and the record', () => {
    // EXPERIENCE.md → UI cleanup: Replay and Live View "narrate audit actions (\"Searching
    // LoanCore for E-000103\", \"Reading the account status\")".
    expect(toolActionNarration('search', on)).toBe('Searching LoanCore for E-000103');
    expect(toolActionNarration('read-attribute', { ...on, field: 'account_status' }))
      .toBe('Reading the account status');
    expect(planActionNarration('inspect-record', on)).toBe('Opening the record for E-000103 on LoanCore');
  });

  it('carries no plan-step id, no ISO instant, no HTTP fact and no digest', () => {
    const said = [
      ...['create-workspace', 'acquire-population', 'sign-in', 'extract-adapter', 'inspect-record', 'capture-observation', 'evaluate-conditions']
        .map((action) => planActionNarration(action, on)),
      ...PERMITTED_READ_ACTIONS.map((action) => toolActionNarration(action, { ...on, field: 'account_status' })),
    ];
    for (const sentence of said) {
      expect(sentence, sentence).not.toMatch(/GET|POST|HEAD|\b\d{3}\b|plan step|[0-9a-f]{8}-[0-9a-f]{4}|\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('gives every permitted read action a sentence of its own', () => {
    // The eight actions of the frozen registration vocabulary. An action the domain gains
    // without a sentence here falls back to its stored word, which this asserts is not
    // what any current member does.
    const said = PERMITTED_READ_ACTIONS.map((action) => toolActionNarration(action, on));
    expect(new Set(said).size).toBe(PERMITTED_READ_ACTIONS.length);
    for (const [index, action] of PERMITTED_READ_ACTIONS.entries()) {
      expect(said[index], action).toMatch(/^[A-Z][a-z]/);
    }
  });

  it('never leaves a dangling "for" when the unit inspected no record', () => {
    // P-4 inspects a page, not a population.
    const said = [
      planActionNarration('inspect-record', { subject: null, system: 'ProdConsole' }),
      planActionNarration('capture-observation', { subject: null, system: 'ProdConsole' }),
      planActionNarration('evaluate-conditions', { subject: null, system: 'ProdConsole' }),
      toolActionNarration('search', { subject: null, system: 'ProdConsole' }),
      toolActionNarration('open-record', { subject: null, system: 'ProdConsole' }),
    ];
    for (const sentence of said) expect(sentence, sentence).not.toMatch(/ for\s*$|for on/);
  });

  it('says the general sentence when no attribute label was resolved', () => {
    // A Tool Action parameter NAME is a form field read off a page the Target System
    // controls, so it never becomes platform prose: with nothing resolved, the sentence
    // says what it knows rather than guessing a field.
    expect(toolActionNarration('read-attribute', on)).toBe('Reading an approved field on LoanCore');
    expect(toolActionNarration('read-attribute', { ...on, field: '  ' })).toBe('Reading an approved field on LoanCore');
    expect(toolActionNarration('read-attribute', { ...on, field: null })).toBe('Reading an approved field on LoanCore');
  });

  it('shows an action outside either vocabulary as it was stored', () => {
    // `Object.hasOwn`, so a stored `constructor` does not resolve to a function.
    expect(planActionNarration('constructor', on)).toBe('constructor for E-000103 on LoanCore');
    expect(toolActionNarration('toString', { subject: null, system: null })).toBe('toString');
  });
});

describe('what the Work Item rail says with no Work Item (UX-49)', () => {
  it('gives every Run state a sentence that is true of that state', () => {
    for (const state of RUN_STATES) {
      const sentence = noWorkItemSentence(state);
      expect(Object.values(NO_WORK_ITEM), state).toContain(sentence);
    }
  });

  it('never tells a finished Run that no record is being inspected YET', () => {
    // THE FINDING: a COMPLETED Run said "No Work Item is being worked yet." — "yet" is a
    // claim about a future only an active Run has.
    for (const state of ['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED']) {
      expect(noWorkItemSentence(state), state).toBe(NO_WORK_ITEM.finished);
      expect(noWorkItemSentence(state), state).not.toContain('yet');
    }
    expect(noWorkItemSentence('QUEUED')).toContain('yet');
  });

  it('distinguishes a held Run from one that is simply between records', () => {
    expect(noWorkItemSentence('PAUSED')).toBe(NO_WORK_ITEM.paused);
    expect(noWorkItemSentence('AWAITING_AUDITOR')).toBe(NO_WORK_ITEM.waiting);
    expect(noWorkItemSentence('RUNNING')).toBe(NO_WORK_ITEM.working);
    expect(noWorkItemSentence('constructor')).toBe(NO_WORK_ITEM.working);
  });
});

describe('the record’s own position and the attempt context (UX-29, UX-47)', () => {
  it('names the record beside its frame position, with the noun agreeing', () => {
    expect(recordFramePosition('E-000103', 2, 5)).toBe('E-000103 · frame 2 of 5 frames for this record');
    expect(recordFramePosition('E-000103', 1, 1)).toBe('E-000103 · frame 1 of 1 frame for this record');
  });

  it('says nothing about an attempt that is the first one', () => {
    expect(attemptContext(1)).toBeNull();
    expect(attemptContext(0)).toBeNull();
    expect(attemptContext(2)).toBe('attempt 2');
  });
});
