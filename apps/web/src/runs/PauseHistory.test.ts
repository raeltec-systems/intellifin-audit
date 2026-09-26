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
const NAMER = pauseStepNamer(PLAN, new Map());

const AUDITOR = '019823ab-0000-7000-8000-000000000007';
const SUPERSEDED = '019823ab-0000-7000-8000-0000000000c1';
const RESTARTED = '019823ab-0000-7000-8000-0000000000c2';
const NAMES: ReadonlyMap<string, string> = new Map([[AUDITOR, 'Daniel Okonjo']]);

const FIRST: RunPauseEntry = {
  waitId: '019823ab-0000-7000-8000-0000000000d1',
  pausedAt: '2026-09-26T09:00:00.000Z',
  pausedBy: AUDITOR,
  deadline: '2026-09-26T09:30:00.000Z',
  mode: 'immediate',
  hold: {
    kind: 'recorded',
    planStepId: SIGN_IN.id,
    workItem: null,
    superseded: { stepExecutionId: SUPERSEDED, planStepId: SIGN_IN.id, attempt: 1, workItem: null },
    settled: null,
  },
  closure: {
    kind: 'resumed',
    resumedBy: AUDITOR,
    resumedAt: '2026-09-26T09:05:00.000Z',
    restart: { kind: 'started', attempt: { stepExecutionId: RESTARTED, planStepId: SIGN_IN.id, attempt: 2, workItem: null } },
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
    const step = NAMER.step(SIGN_IN.id, null);
    const sentences = [
      PAUSE_WORDS.heading,
      pauseTitleWords(1),
      pausedByWords('Daniel Okonjo', readableStamp(FIRST.pausedAt)),
      heldInFlightWords(step, 1),
      resumedByWords('Daniel Okonjo', readableStamp('2026-09-26T09:05:00.000Z')),
      restartedWords(step, 2),
      pauseTitleWords(2),
      heldBeforeWords(step),
      PAUSE_WORDS.noStepInFlight,
      PAUSE_WORDS.stillPaused,
    ];
    let from = 0;
    for (const sentence of sentences) {
      const at = html.indexOf(sentence, from);
      expect(at, sentence).toBeGreaterThanOrEqual(from);
      from = at + sentence.length;
    }
    // The exact Step Executions: the attempt the pause superseded and the one the resume started.
    expect(html).toContain(`title="${SUPERSEDED}"`);
    expect(html).toContain(`Step Execution <span class="ls-mono">${shortReference(RESTARTED)}</span>`);
    // A person, never a user id.
    expect(html).not.toContain(`Paused by ${AUDITOR}`);
    // A list of pauses, each with its own heading under the section's.
    expect(html).toContain('<h2 id="pause-history-heading">');
    expect(html.match(/<h3>/g)).toHaveLength(2);
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
      hold: { kind: 'read', sentences: ['First.', 'Second.'], supersededStepExecutionId: SUPERSEDED },
    }));
    expect(html).toContain('First. Second.');
    expect(html).toContain(`title="${SUPERSEDED}"`);
  });

  it('says an unreadable hold is unreadable', () => {
    for (const hold of [{ kind: 'unreadable' }, { kind: 'none' }] as const) {
      expect(renderToStaticMarkup(React.createElement(PauseHoldNote, { hold }))).toContain(PAUSE_WORDS.holdUnreadable);
    }
  });
});
