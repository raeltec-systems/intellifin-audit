import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { REPLAY_COPY } from '../design/copy';
import { ReplayViewer, type ReplayFrameView } from './ReplayViewer';
import type { ReplayJumpTarget } from './replay';

/**
 * The Replay surface as the server first paints it (Story 5.8, UX-DR26).
 *
 * SSR is exactly the state UX-DR26 fixes — paused, at the first frame — so this render is
 * the contract rather than a convenience. It also proves the two things that must be true
 * of the markup itself: every frame is fetched through the Run's own protected route, and
 * a frame's `alt` is its Step's narration.
 */

const RUN_ID = '019823ab-0000-7000-8000-000000000001';

function frameView(index: number, overrides: Partial<ReplayFrameView> = {}): ReplayFrameView {
  return {
    evidenceId: `019823ab-0000-7000-8000-00000000000${index}`,
    narration: `Read record on LoanCore, plan step agent-${index}, started 2026-09-10T09:0${index}:00.000Z.`,
    stepNarration: `Read record on LoanCore, plan step agent-${index}, started 2026-09-10T09:0${index}:00.000Z.`,
    sourceLocation: 'https://synthetic.invalid/loancore/records/1',
    digest: 'a'.repeat(64),
    capturedAt: `2026-09-10T09:0${index}:00.000Z`,
    workItemLabel: 'Leaver 1',
    action: {
      action: 'read-attribute',
      method: 'GET',
      destination: 'https://synthetic.invalid/loancore/records/1',
      outcome: 'performed',
      status: 200,
      denial: null,
      capture: 'PERMITTED',
      captureSuppression: null,
      startedAt: `2026-09-10T09:0${index}:00.000Z`,
    },
    observations: index,
    ...overrides,
  };
}

function render(input: Partial<React.ComponentProps<typeof ReplayViewer>> = {}): string {
  return renderToStaticMarkup(React.createElement(ReplayViewer, {
    runId: RUN_ID,
    stateSentence: 'Session REPLAY. This Run ended: COMPLETED.',
    workspace: { mode: 'solari', workspaceId: 'ws-1' },
    frames: [frameView(1), frameView(2), frameView(3)],
    framesTotal: 3,
    plannedSteps: 4,
    stageNote: REPLAY_COPY.noFrames,
    jumpTargets: [],
    instructions: [],
    adapterSteps: [],
    ...input,
  }));
}

describe('Replay, as the server first paints it', () => {
  it('starts PAUSED at the first frame', () => {
    const html = render();
    // Paused: the control offers Play. A Replay that started playing would move a session
    // under somebody who opened it to look at one thing.
    expect(html).toContain(`>${REPLAY_COPY.play}<`);
    expect(html).not.toContain(`>${REPLAY_COPY.pause}<`);
    expect(html).toContain('Frame 1 of 3');
    expect(html).toContain('/frames/019823ab-0000-7000-8000-000000000001');
    expect(html).not.toContain('/frames/019823ab-0000-7000-8000-000000000002');
  });

  it('shows REPLAY chrome and never a live one', () => {
    const html = render();
    expect(html).toContain('REPLAY');
    expect(html).toContain('ls-session__dot--replay');
    expect(html).not.toContain('ls-session__dot--live');
  });

  it('fetches every frame through the Run’s own route and never an object store', () => {
    // The structural form of AD-5's claim: a signed store URL would fail this, and the
    // web cannot import the store at all (`no-evidence-store-in-web`).
    const sources = [...render().matchAll(/src="([^"]+)"/g)].map((match) => match[1]!);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) expect(src.startsWith(`/api/runs/${RUN_ID}/`)).toBe(true);
  });

  it('gives the frame the SAME sentence as its Step (UX-DR37)', () => {
    const view = frameView(1);
    const html = render({ frames: [view], framesTotal: 1 });
    expect(html).toContain(`alt="${view.stepNarration}"`);
  });

  it('offers one scrubber pill per frame, with the current one marked', () => {
    const html = render();
    expect([...html.matchAll(/ls-scrubber-pill/g)]).toHaveLength(4); // three pills, one current modifier
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('Frame 2 of 3: Read record on LoanCore');
  });

  it('says a Run captured nothing rather than showing an empty stage', () => {
    const html = render({ frames: [], framesTotal: 0 });
    expect(html).toContain(REPLAY_COPY.noFrames);
    expect(html).toContain('No frames');
    expect(html).not.toContain('<img');
  });

  it('says when the frame list is bounded, and stays quiet when it is not', () => {
    expect(render({ framesTotal: 900 })).toContain('Showing the first 3 of 900 frames.');
    expect(render()).not.toContain('Showing the first');
  });

  it('names a jump target that has nowhere to go instead of offering a dead pill', () => {
    const targets: readonly ReplayJumpTarget[] = [
      { kind: 'work-item', id: 'w1', label: 'Leaver 1', frameIndex: 0 },
      { kind: 'work-item', id: 'w2', label: 'Adapter read', frameIndex: null },
    ];
    const html = render({ jumpTargets: targets });
    expect(html).toContain('Leaver 1');
    expect(html).toContain(REPLAY_COPY.noFrameForTarget);
    // The reachable one is a button; the unreachable one is not.
    expect([...html.matchAll(/ls-button--ghost/g)]).toHaveLength(1);
  });

  it('renders the auditor’s frozen Audit Instructions verbatim and inert', () => {
    const html = render({ instructions: [{ system: 'LoanCore', text: '<b>Read</b> every leaver.' }] });
    expect(html).toContain('&lt;b&gt;Read&lt;/b&gt; every leaver.');
    expect(html).not.toContain('<b>Read</b>');
  });
});
