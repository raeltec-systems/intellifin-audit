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
import { LIVE_VIEW_STAGE } from './live-view';

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
    chrome: 'LIVE',
    stateSentence: 'Session LIVE.',
    workspace: { mode: 'solari', workspaceId: 'sess_5f2a', status: 'OPEN' },
    stepsStarted: 3,
    plannedSteps: 8,
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
    expect(html).toContain('sess_5f2a');
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
    expect(html).toContain('No Work Item is being worked yet.');
    expect(html).toContain('No Evidence has been registered yet.');
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
    expect(html).toContain('session-2');
    expect(html).toContain('ACQUIRED');
    expect(html).toContain('b'.repeat(64));
  });
});

describe('the ended banner', () => {
  it('names the terminal state and links to Run Detail (UX-DR25)', () => {
    const html = renderToStaticMarkup(React.createElement(EndedBanner, { runId: RUN_ID, state: 'COMPLETED' }));
    expect(html).toContain('This Run has ended: COMPLETED.');
    expect(html).toContain(`href="/runs/${RUN_ID}"`);
  });
});
