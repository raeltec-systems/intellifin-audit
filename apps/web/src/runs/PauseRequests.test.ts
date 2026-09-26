import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { deriveExecutablePlan, type ExecutablePlan } from '@intellifin/domain';
import type { RunPauseEntry, RunPauseHistory, RunPauseRequestEntry, RunPauseRequestHistory } from '@intellifin/infrastructure';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { readableStamp } from '../design/time';
import { PAUSE_REQUEST_WORDS } from './decision-words';
import { PauseHistorySection } from './PauseHistory';
import { PAUSE_WORDS, pauseTitleWords } from './pause-words';

/**
 * A pause the Run never reached, as an entry in "Pauses and resumes" (Story 10.10, legacy
 * 5.4 AC 3), rendered through the section 10.6 built.
 */

const derived = deriveExecutablePlan(executablePlanInputs());
if (!derived.ok) throw new Error(`The fixture plan did not compile: ${derived.reason}`);
const PLAN: ExecutablePlan = derived.plan;
const INSPECT = PLAN.targetSystems[0]!.planSteps.find((step) => step.action === 'inspect-record')!;

const AUDITOR = '019823ab-0000-7000-8000-000000000007';
const NAMES: ReadonlyMap<string, string> = new Map([[AUDITOR, 'Daniel Okonjo']]);

const PAUSED: RunPauseEntry = {
  waitId: '019823ab-0000-7000-8000-0000000000d1',
  pausedAt: '2026-09-26T09:00:00.000Z',
  pausedBy: AUDITOR,
  deadline: '2026-09-26T09:30:00.000Z',
  mode: 'immediate',
  hold: { kind: 'not-recorded' },
  closure: { kind: 'resumed', resumedBy: AUDITOR, resumedAt: '2026-09-26T09:05:00.000Z', restart: { kind: 'not-recorded' } },
};

const OUTRUN: RunPauseRequestEntry = {
  eventId: '019823ab-0000-7000-8000-0000000000b1',
  mode: 'immediate',
  requestedBy: AUDITOR,
  requestedAt: '2026-09-26T09:20:00.000Z',
  supersededAt: '2026-09-26T09:25:00.000Z',
  outcome: 'run-ended',
  inspection: null,
};

const REPLACED: RunPauseRequestEntry = {
  eventId: '019823ab-0000-7000-8000-0000000000b2',
  mode: 'after-inspection',
  requestedBy: AUDITOR,
  requestedAt: '2026-09-26T08:50:00.000Z',
  supersededAt: '2026-09-26T08:55:00.000Z',
  outcome: 'replaced',
  inspection: { planStepId: INSPECT.id, workItem: { workItemId: '019823ab-0000-7000-8000-0000000000e1', subjectKey: 'E-000102' } },
};

function render(history: RunPauseHistory, requests: RunPauseRequestHistory): string {
  return renderToStaticMarkup(React.createElement(PauseHistorySection, {
    history, plan: PLAN, recordNames: new Map(), actorNames: NAMES,
    requests: { requests, plan: PLAN, recordNames: new Map(), actorNames: NAMES },
  }));
}

describe('a pause request the Run never honoured, in "Pauses and resumes"', () => {
  it('renders the section for a Run whose only pause request was outrun, and says who asked, when, and that the Run ended first', () => {
    const html = render({ total: 0, entries: [] }, { total: 1, entries: [OUTRUN] });
    expect(html).toContain(PAUSE_WORDS.heading);
    expect(html).toContain(`<h3>${PAUSE_REQUEST_WORDS.title}</h3>`);
    expect(html).toContain(`Requested by Daniel Okonjo at ${readableStamp(OUTRUN.requestedAt!)}.`);
    expect(html).toContain(PAUSE_REQUEST_WORDS.runEnded);
    expect(html).toContain('data-pause-request="immediate"');
    expect(html).not.toContain(AUDITOR);
  });

  it('still renders nothing for a Run neither paused nor asked to pause', () => {
    expect(render({ total: 0, entries: [] }, { total: 0, entries: [] })).toBe('');
  });

  it('lists requests among the pauses in the order they were asked for, and each pause keeps its ordinal', () => {
    const html = render({ total: 1, entries: [PAUSED] }, { total: 2, entries: [OUTRUN, REPLACED] });
    const replaced = html.indexOf('data-event-id="019823ab-0000-7000-8000-0000000000b2"');
    const paused = html.indexOf(`<h3>${pauseTitleWords(1)}</h3>`);
    const outrun = html.indexOf('data-event-id="019823ab-0000-7000-8000-0000000000b1"');
    expect(replaced).toBeGreaterThan(-1);
    expect(paused).toBeGreaterThan(replaced);
    expect(outrun).toBeGreaterThan(paused);
    expect(html).not.toContain(pauseTitleWords(2));
  });

  it('says which inspection a "pause after this inspection" request named, and that a pause at once replaced it', () => {
    const html = render({ total: 0, entries: [] }, { total: 1, entries: [REPLACED] });
    expect(html).toContain('data-pause-request="after-inspection"');
    expect(html).toContain(`It asked to pause after “Inspect the record” for E-000102 on ProdConsole. ${PAUSE_REQUEST_WORDS.replaced}`);
    expect(html).not.toContain(PAUSE_REQUEST_WORDS.runEnded);
  });

  it('says what the record does not hold rather than leaving a blank', () => {
    const html = render({ total: 0, entries: [] }, { total: 1, entries: [{ ...OUTRUN, requestedBy: null, requestedAt: null }] });
    expect(html).toContain(PAUSE_REQUEST_WORDS.requesterNotRecorded);
    expect(html).not.toContain('Requested by');
  });

  it('says when the list does not hold every request', () => {
    const html = render({ total: 0, entries: [] }, { total: 250, entries: [OUTRUN] });
    expect(html).toContain('Showing the first 1 of 250 pause requests.');
  });
});
