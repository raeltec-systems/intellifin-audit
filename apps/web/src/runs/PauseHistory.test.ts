import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { deriveExecutablePlan, type ExecutablePlan } from '@intellifin/domain';
import type { RunPauseEntry, RunPauseHistory } from '@intellifin/infrastructure';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { shortReference } from '../design/references';
import { readableStamp } from '../design/time';
import { PauseHistorySection, PauseHoldNote } from './PauseHistory';
import {
  PAUSE_WORDS,
  heldBeforeWords,
  heldInFlightWords,
  pauseStepNamer,
  pauseTitleWords,
  pausedByWords,
  pausesShownWords,
  restartedWords,
  resumedByWords,
  startedWords,
  timedOutWords,
} from './pause-words';

/**
 * The Execution Timeline's pause history, rendered (Story 10.6, legacy 5.4). Each
 * sentence is read back out of the markup through the function that builds it, so the
 * section cannot say a sentence the words module does not hold.
 */

const derived = deriveExecutablePlan(executablePlanInputs());
if (!derived.ok) throw new Error(`The fixture plan did not compile: ${derived.reason}`);
const PLAN: ExecutablePlan = derived.plan;
const SIGN_IN = PLAN.sessionSteps.find((step) => step.action === 'sign-in')!;
const INSPECT = PLAN.targetSystems[0]!.planSteps.find((step) => step.action === 'inspect-record')!;
const NAMER = pauseStepNamer(PLAN, new Map());
const ITEM = { workItemId: '019823ab-0000-7000-8000-0000000000b1', subjectKey: 'E-000102' };

const AUDITOR = '019823ab-0000-7000-8000-000000000007';
const SUPERSEDED = '019823ab-0000-7000-8000-0000000000c1';
const RESTARTED = '019823ab-0000-7000-8000-0000000000c2';
const NAMES: ReadonlyMap<string, string> = new Map([[AUDITOR, 'Daniel Okonjo']]);

/**
 * A pause the Work Item stage honoured mid-attempt, as a Run produces one: the attempt is
 * given back, so the restart carries the SAME attempt number in a new Step Execution.
 */
const FIRST: RunPauseEntry = {
  waitId: '019823ab-0000-7000-8000-0000000000d1',
  pausedAt: '2026-09-26T09:00:00.000Z',
  pausedBy: AUDITOR,
  deadline: '2026-09-26T09:30:00.000Z',
  mode: 'immediate',
  hold: {
    kind: 'recorded',
    planStepId: INSPECT.id,
    workItem: ITEM,
    superseded: { stepExecutionId: SUPERSEDED, planStepId: INSPECT.id, attempt: 1, workItem: ITEM },
    settled: null,
  },
  closure: {
    kind: 'resumed',
    resumedBy: AUDITOR,
    resumedAt: '2026-09-26T09:05:00.000Z',
    restart: { kind: 'started', attempt: { stepExecutionId: RESTARTED, planStepId: INSPECT.id, attempt: 1, workItem: ITEM } },
  },
};

const SECOND: RunPauseEntry = {
  waitId: '019823ab-0000-7000-8000-0000000000d2',
  pausedAt: '2026-09-26T09:10:00.000Z',
  pausedBy: AUDITOR,
  deadline: '2026-09-26T09:40:00.000Z',
  mode: 'immediate',
  hold: { kind: 'recorded', planStepId: SIGN_IN.id, workItem: null, superseded: null, settled: null },
  closure: { kind: 'open' },
};

/** A pause between units, before the sign-in: its resume STARTED the sign-in. */
const BEFORE_SIGN_IN: RunPauseEntry = {
  ...SECOND,
  waitId: '019823ab-0000-7000-8000-0000000000d4',
  closure: {
    kind: 'resumed',
    resumedBy: AUDITOR,
    resumedAt: '2026-09-26T09:12:00.000Z',
    restart: { kind: 'started', attempt: { stepExecutionId: RESTARTED, planStepId: SIGN_IN.id, attempt: 1, workItem: null } },
  },
};

const HISTORICAL: RunPauseEntry = {
  ...SECOND,
  waitId: '019823ab-0000-7000-8000-0000000000d3',
  hold: { kind: 'not-recorded' },
  closure: { kind: 'resumed', resumedBy: AUDITOR, resumedAt: '2026-09-26T09:15:00.000Z', restart: { kind: 'not-recorded' } },
};

/** A Run with no pause request left unhonoured: the list is the pauses alone (Story 10.10). */
const NO_REQUESTS = { requests: { total: 0, entries: [] }, plan: null, recordNames: new Map(), actorNames: new Map() } as const;

function render(history: RunPauseHistory, plan: ExecutablePlan | null = PLAN): string {
  return renderToStaticMarkup(
    React.createElement(PauseHistorySection, { history, plan, recordNames: new Map(), actorNames: NAMES, requests: NO_REQUESTS }),
  );
}

describe('the pause history on the Execution Timeline', () => {
  it('says, for every pause in order, where it held the Run and which attempt its resume started', () => {
    const html = render({ total: 2, entries: [FIRST, SECOND] });
    // The words, read as a reader reads them: the record key sits in its own span.
    const text = html.replace(/<[^>]+>/g, '');
    const inspect = NAMER.step(INSPECT.id, ITEM);
    const signIn = NAMER.step(SIGN_IN.id, null);
    const sentences = [
      PAUSE_WORDS.heading,
      PAUSE_WORDS.intro,
      pauseTitleWords(1),
      pausedByWords('Daniel Okonjo', readableStamp(FIRST.pausedAt)),
      heldInFlightWords(inspect, 1),
      resumedByWords('Daniel Okonjo', readableStamp('2026-09-26T09:05:00.000Z')),
      restartedWords(inspect, 1),
      pauseTitleWords(2),
      heldBeforeWords(signIn),
      PAUSE_WORDS.noStepInFlight,
      PAUSE_WORDS.stillPaused,
    ];
    let from = 0;
    for (const sentence of sentences) {
      const at = text.indexOf(sentence, from);
      expect(at, sentence).toBeGreaterThanOrEqual(from);
      from = at + sentence.length;
    }
    // The record key is kept on one line, in each sentence that names it: E-000102 would
    // otherwise break after its hyphen.
    expect(html.match(/<span class="ls-nowrap">E-000102<\/span>/g)).toHaveLength(2);
    // The exact Step Executions: the attempt the pause superseded and the one the resume started.
    expect(html).toContain(`title="${SUPERSEDED}"`);
    expect(html).toContain(`Step Execution <span class="ls-mono">${shortReference(RESTARTED)}</span>`);
    // A person, never a user id.
    expect(html).not.toContain(`Paused by ${AUDITOR}`);
    // A list of pauses, each with its own heading under the section's.
    expect(html).toContain('<h2 id="pause-history-heading">');
    expect(html.match(/<h3>/g)).toHaveLength(2);
  });

  // Screenshot review, 2026-09-26: a pause held BEFORE the sign-in said its resume
  // "restarted" a sign-in that had never begun.
  it('says a resume after a pause between units started the held step, never that it restarted it', () => {
    const html = render({ total: 1, entries: [BEFORE_SIGN_IN] });
    const signIn = NAMER.step(SIGN_IN.id, null);
    expect(html).toContain(startedWords(signIn, 1));
    expect(html).not.toContain('It restarted');
    expect(html).toContain(`title="${RESTARTED}"`);
  });

  it('says a pause that ran out reached its deadline at the DEADLINE, not when the wake closed it', () => {
    const html = render({ total: 1, entries: [{ ...SECOND, closure: { kind: 'timed-out', at: '2026-09-26T10:41:00.000Z' } }] });
    expect(html).toContain(timedOutWords(readableStamp(SECOND.deadline)));
    expect(html).not.toContain(readableStamp('2026-09-26T10:41:00.000Z'));
  });

  it('says what a historical pause did not record, rather than showing nothing', () => {
    const html = render({ total: 1, entries: [HISTORICAL] });
    expect(html).toContain(PAUSE_WORDS.heldNotRecorded);
    expect(html).toContain(PAUSE_WORDS.restartNotRecorded);
    expect(html).not.toContain('Step Execution <span');
  });

  it('names a step the frozen plan could not be read for by the identifier the event recorded', () => {
    const html = render({ total: 1, entries: [SECOND] }, null);
    expect(html).toContain(heldBeforeWords(`plan step “${SIGN_IN.id}”`));
  });

  it('says so when the bounded list does not hold every pause', () => {
    expect(render({ total: 101, entries: [FIRST] })).toContain(pausesShownWords(1, 101));
    expect(render({ total: 1, entries: [FIRST] })).not.toContain(pausesShownWords(1, 1));
  });

  it('renders nothing for a Run that was never paused', () => {
    expect(render({ total: 0, entries: [] })).toBe('');
  });
});

describe('the hold note on the Paused banner', () => {
  it('says the hold it read, with the attempt it superseded', () => {
    const html = renderToStaticMarkup(React.createElement(PauseHoldNote, {
      hold: { kind: 'read', sentences: ['First.', 'Second.'], supersededStepExecutionId: SUPERSEDED, resume: 'restart', keys: [] },
    }));
    expect(html).toContain('First. Second.');
    expect(html).toContain(`title="${SUPERSEDED}"`);
  });

  it('keeps the record key the hold names on one line', () => {
    const html = renderToStaticMarkup(React.createElement(PauseHoldNote, {
      hold: { kind: 'read', sentences: ['The Run is held before E-000102.'], supersededStepExecutionId: null, resume: 'start', keys: ['E-000102'] },
    }));
    expect(html).toContain('The Run is held before <span class="ls-nowrap">E-000102</span>.');
  });

  it('says an unreadable hold is unreadable', () => {
    for (const hold of [{ kind: 'unreadable' }, { kind: 'none' }] as const) {
      expect(renderToStaticMarkup(React.createElement(PauseHoldNote, { hold }))).toContain(PAUSE_WORDS.holdUnreadable);
    }
  });
});
