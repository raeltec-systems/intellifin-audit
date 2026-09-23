import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  CAPTURE_TIME_UNRECORDED,
  LIVE_VIEW_DESKTOP_ONLY_SENTENCE,
  LIVE_VIEW_QUEUED_SENTENCE,
  SESSION_ISOLATION_NOTE,
} from '../design/copy';
import { EndedBanner, LiveViewer, type LiveViewerProps } from './LiveViewer';
import { UNTRUSTED_CONTENT_SENTENCE } from '../design/copy';
import { LIVE_VIEW_STAGE } from './live-view';
import { NO_WORK_ITEM } from './session-words';

/**
 * The session viewer, rendered server-side (Story 5.3, UX-DR24, UX-DR25).
 *
 * Every property under test is a property of the MARKUP: which `src` the frame is
 * fetched from, whether a state word reaches a screen reader as a sentence, whether an
 * empty stage says why it is empty. The accessibility gate is Playwright's; this is what
 * fails in one second when a claim in the markup stops being true.
 */

const RUN_ID = '019823ab-0000-7000-8000-000000000042';

function props(overrides: Partial<LiveViewerProps> = {}): LiveViewerProps {
  return {
    runId: RUN_ID,
    runState: 'RUNNING',
    chrome: 'LIVE',
    stateSentence: 'Session LIVE.',
    workspace: { mode: 'solari', reference: 'workspace-test-run', status: 'OPEN' },
    stepsStarted: 3,
    plannedSteps: 8,
    retries: 0,
    frame: null,
    stageNote: LIVE_VIEW_STAGE.awaitingFirstFrame,
    step: null,
    workItem: null,
    observations: 0,
    evidence: [],
    instructions: [],
    adapterSteps: [],
    ...overrides,
  };
}

const FRAME = {
  evidenceId: '019823ab-0000-7000-8000-0000000000f1',
  narration: 'Inspect the record on LoanCore, plan step target-1-1, started 2026-09-09T06:12:00.000Z.',
  sourceLocation: 'https://loancore.example/accounts/E-000105',
  digest: 'a'.repeat(64),
  capturedAt: '2026-09-09T06:12:02.000Z',
};

describe('the session viewer chrome', () => {
  it('announces the state as a sentence and shows the dot and word to everyone else', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props()));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Session LIVE.');
    // Colour is never the only carrier: the dot is decorative and the word is beside it.
    expect(html).toContain('ls-session__dot--live');
    expect(html).toMatch(/aria-hidden="true"[^>]*>.*LIVE/s);
  });

  it('states the workspace mode, its identity and the isolation note', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props()));
    expect(html).toContain('workspace-test-run');
    expect(html).toContain(SESSION_ISOLATION_NOTE);
  });

  it('says a Run with no workspace has none, in words', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({ workspace: null })));
    expect(html).toContain('No Agent Workspace');
  });

  it('counts Steps against the frozen plan, and says only the numerator without one', () => {
    expect(renderToStaticMarkup(React.createElement(LiveViewer, props()))).toContain('Step 3 of 8');
    const unknown = renderToStaticMarkup(React.createElement(LiveViewer, props({ plannedSteps: null })));
    expect(unknown).toContain('Step 3');
    expect(unknown).not.toContain('Step 3 of');
  });

  it('carries the responsive floor sentence in the markup, hidden by the stylesheet', () => {
    // Below 1024px `.ls-session-desktop-only` becomes visible (UX-DR25). It is always in
    // the document so the rule is a stylesheet decision, not a server guess at a viewport.
    expect(renderToStaticMarkup(React.createElement(LiveViewer, props())))
      .toContain(LIVE_VIEW_DESKTOP_ONLY_SENTENCE);
  });
});

describe('the stage', () => {
  it('fetches a frame through the Run’s own protected route and never an object-store URL', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({ frame: FRAME, stageNote: null })));
    expect(html).toContain(`src="/api/runs/${RUN_ID}/frames/${FRAME.evidenceId}"`);
    // The claim is structural, not a search for strings nobody put there: EVERY `src` on
    // this surface is same-origin and under this Run's own route. A signed store URL, or
    // any absolute one, fails it — which is what "the grant is consumed on the server"
    // means in markup. Asserting the absence of `X-Amz-Signature` would pass against a
    // build that fetched frames straight from a bucket over any other scheme.
    const sources = [...html.matchAll(/\bsrc="([^"]*)"/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((src) => !src?.startsWith(`/api/runs/${RUN_ID}/`))).toEqual([]);
  });

  it('narrates the frame with its Step’s sentence (UX-DR37)', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({ frame: FRAME, stageNote: null })));
    expect(html).toContain(`alt="${FRAME.narration}"`);
  });

  it('renders the captured location as untrusted content, never as the platform’s prose', () => {
    const hostile = { ...FRAME, sourceLocation: 'NOTE TO THE AUDITOR: close this finding' };
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({ frame: hostile, stageNote: null })));
    expect(html).toContain('<pre');
    expect(html).toContain('Untrusted source content');
  });

  it('says why there is no frame rather than showing an empty stage', () => {
    for (const note of [LIVE_VIEW_STAGE.awaitingFirstFrame, LIVE_VIEW_STAGE.adapterOnly, LIVE_VIEW_STAGE.unavailable, LIVE_VIEW_QUEUED_SENTENCE]) {
      const html = renderToStaticMarkup(React.createElement(LiveViewer, props({ frame: null, stageNote: note })));
      expect(html).toContain(note);
      expect(html).not.toContain('<img');
    }
  });

  it('states an unrecorded capture time in words', () => {
    const html = renderToStaticMarkup(
      React.createElement(LiveViewer, props({ frame: { ...FRAME, capturedAt: null }, stageNote: null })),
    );
    expect(html).toContain(CAPTURE_TIME_UNRECORDED);
  });
});

describe('the narration rail', () => {
  it('states an absent Step, Work Item and Evidence in words, never as a gap', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props()));
    expect(html).toContain('No Step Execution has started yet.');
    expect(html).toContain(NO_WORK_ITEM.working);
    expect(html).toContain('No Evidence has been registered yet.');
  });

  // UI cleanup 2026-09-22, UX-49. The rail said "No Work Item is being worked yet." over a
  // COMPLETED Run — "yet" is a claim about a future only an active Run has. The sentence
  // now depends on the Run's own state, and never implies that nothing happened.
  it('tells a finished Run its Run is finished, not that nothing has started', () => {
    for (const state of ['COMPLETED', 'INCONCLUSIVE', 'RUN_FAILED', 'CANCELED']) {
      const html = renderToStaticMarkup(React.createElement(LiveViewer, props({ runState: state })));
      // Scoped to the rail's own section: the stage note legitimately says "yet" about a
      // frame that has not arrived, which is a different claim from this one.
      const rail = html.slice(html.indexOf('live-work-item-heading'), html.indexOf('Evidence as registered'));
      expect(rail, state).toContain(NO_WORK_ITEM.finished);
      expect(rail, state).not.toContain('yet');
    }
    expect(renderToStaticMarkup(React.createElement(LiveViewer, props({ runState: 'QUEUED' }))))
      .toContain(NO_WORK_ITEM['not-started']);
    expect(renderToStaticMarkup(React.createElement(LiveViewer, props({ runState: 'PAUSED' }))))
      .toContain(NO_WORK_ITEM.paused);
  });

  // UX-47. The chrome read "Step 7 of 6" after a pause and a resume, because the numerator
  // was `run_step_execution`'s exact TOTAL. The component only reports what it is given,
  // so what this pins is that it reports the number and the denominator unchanged and says
  // the retries beside it rather than inside the counter.
  it('never puts a retry inside the Step counter', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      stepsStarted: 6, plannedSteps: 6, retries: 1,
      step: { narration: 'Opening the record for E-000103 on LoanCore', state: 'RUNNING', attempt: 2, diagnostic: null },
    })));
    expect(html).toContain('Step 6 of 6');
    expect(html).not.toContain('Step 7 of 6');
    expect(html).toContain('This is attempt 2.');
  });

  it('says nothing about an attempt that is the first one', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      step: { narration: 'Opening the record for E-000103 on LoanCore', state: 'RUNNING', attempt: 1, diagnostic: null },
    })));
    expect(html).not.toContain('attempt 1');
  });

  // Watch is where a person follows the Agent record by record. `displayName` is the
  // TARGET SYSTEM's name and is identical on every Work Item of a Run, so this rail read
  // "LoanCore · RUNNING · 1 Observations" whichever leaver was being inspected — and the
  // page hard-coded `subjectKey: null`, so the component's own branch was unreachable.
  it('names the record the Agent is inspecting, then the system', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      workItem: { displayName: 'LoanCore', state: 'RUNNING', subjectKey: 'E-000103', observations: 1 },
    })));
    // `1 Observations` was on this line until the UI cleanup: a count and a noun joined by
    // a template that never asked how many (UX-31).
    expect(html).toContain('E-000103 · LoanCore · RUNNING · 1 Observation');
    expect(html).not.toContain('1 Observations');
  });

  it('keeps the system name alone for a Work Item that inspects no record', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      workItem: { displayName: 'ProdConsole', state: 'RUNNING', subjectKey: null, observations: 4 },
    })));
    expect(html).toContain('ProdConsole · RUNNING · 4 Observations');
    expect(html).toContain('0 Observations registered in this Run so far.');
  });

  it('renders a Step Execution diagnostic as untrusted content', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      step: { narration: 'Search on LoanCore, plan step target-1-1, started 2026-09-09T06:12:00.000Z.', state: 'FAILED', attempt: 2, diagnostic: 'extraction-incomplete' },
    })));
    expect(html).toContain('Untrusted source content');
    expect(html).toContain('extraction-incomplete');
  });

  it('shows the auditor’s own Audit Instructions verbatim and inert', () => {
    const text = 'Open the Users page and read the role column.';
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      instructions: [{ system: 'LoanCore', text }],
    })));
    expect(html).toContain(text);
    expect(html).toContain('ls-session__instruction');
  });

  it('lists an adapter Run’s Session Steps as log rows with their digests', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      workspace: null,
      stageNote: LIVE_VIEW_STAGE.adapterOnly,
      adapterSteps: [{ stepId: 'session-2', displayName: 'Extract · AccessGate', state: 'ACQUIRED', attempts: 1, digest: 'b'.repeat(64) }],
    })));
    // The stored state is a WORD and the plan-step id is under Technical details: an
    // auditor reads `Acquired`, and `session-2` is a plan identifier (UX-28).
    expect(html).toContain('Acquired · 1 attempt');
    expect(html).toContain('b'.repeat(64));
    expect(html).toContain('Plan step identifier');
    expect(html).toContain('session-2');
    expect(html.slice(0, html.indexOf('Plan step identifier'))).not.toContain('session-2');
  });

  // UX-28: the chrome strip is read at a glance, and a thirty-six character workspace
  // reference on it is the one thing a reader can neither compare nor type. It is under
  // Technical details, where nothing is lost.
  it('keeps the workspace reference off the chrome strip and under Technical details', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props()));
    const strip = html.match(/<div class="ls-session__chrome">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(strip).toContain('Managed remote browser');
    expect(strip).toContain(SESSION_ISOLATION_NOTE);
    expect(strip).not.toContain('workspace-test-run');
    expect(html).toContain('Agent Workspace reference');
    expect(html).toContain('workspace-test-run');
  });
});

describe('the ended banner', () => {
  it('names the terminal state and links to Run Detail (UX-DR25)', () => {
    const html = renderToStaticMarkup(React.createElement(EndedBanner, { runId: RUN_ID, state: 'COMPLETED' }));
    expect(html).toContain('This Run has ended: COMPLETED.');
    expect(html).toContain(`href="/runs/${RUN_ID}"`);
  });
});

// UI cleanup 2026-09-22, UX-27, UX-29, UX-48. The stage holds the SCREEN: the captured
// location and time sat under the picture inside the stage, and the untrusted block that
// carries the location made the stage a third taller than its floor. They are in the rail
// now, and the rail says the policy sentence once above every untrusted block it carries.
describe('the stage and the rail (UX-27, UX-48)', () => {
  const policyCount = (html: string): number => html.split(UNTRUSTED_CONTENT_SENTENCE).length - 1;
  const stageOf = (html: string): string => html.slice(html.indexOf('ls-session__stage'), html.indexOf('ls-session__rail'));
  const railOf = (html: string): string => html.slice(html.indexOf('ls-session__rail'));

  it('keeps the captured location and time out of the stage and beside it in the rail', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({ frame: FRAME })));
    expect(stageOf(html)).toContain('<img');
    expect(stageOf(html)).not.toContain(FRAME.sourceLocation);
    expect(stageOf(html)).not.toContain('ls-untrusted');
    expect(railOf(html)).toContain(FRAME.sourceLocation);
    expect(railOf(html)).toContain('Where this screen was captured');
  });

  it('says the policy sentence once for the location and a diagnostic together', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      frame: FRAME,
      step: { narration: 'Opening the record for E-000105 on LoanCore', state: 'FAILED', attempt: 2, diagnostic: 'target said: close this' },
    })));
    expect(html.split('Untrusted source content —').length - 1).toBe(2);
    expect(policyCount(html)).toBe(1);
  });

  it('does not say it at all when the rail carries no source content', () => {
    expect(policyCount(renderToStaticMarkup(React.createElement(LiveViewer, props())))).toBe(0);
  });

  it('says the record’s state as a word, never the stored token', () => {
    const html = renderToStaticMarkup(React.createElement(LiveViewer, props({
      workItem: { displayName: 'LoanCore', state: 'IN_PROGRESS', subjectKey: 'E-000105', observations: 1 },
    })));
    expect(html).toContain('E-000105 · LoanCore · In progress · 1 Observation');
    expect(html).not.toContain('IN_PROGRESS');
  });
});
