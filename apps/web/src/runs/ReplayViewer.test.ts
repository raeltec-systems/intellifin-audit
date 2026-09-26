import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { REPLAY_COPY, UNTRUSTED_CONTENT_SENTENCE } from '../design/copy';
import { ReplayViewer, type ReplayFrameView } from './ReplayViewer';
import type { ReplayJumpTarget } from './replay';
import { ADAPTER_ARTIFACT_WORDS } from './live-view';

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
    narration: `Opening the record for E-00010${index} on LoanCore`,
    stepNarration: `Opening the record for E-00010${index} on LoanCore`,
    workItemId: `019823ab-0000-7000-8000-0000000000c${index}`,
    subjectKey: `E-00010${index}`,
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
    runState: 'COMPLETED',
    stateSentence: 'Session REPLAY. This Run ended: COMPLETED.',
    workspace: { mode: 'solari', reference: 'workspace-test-run' },
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
  it('opens the requested inspection paused at its stored capture', () => {
    const html = render({ initialSelection: { kind: 'inspection', frameIndex: 1,
      target: { kind: 'work-item', id: 'stored-work', label: 'E-2', frameIndex: 1, absence: null } } });
    expect(html).toContain('Frame 2 of 3');
    expect(html).toContain('/frames/019823ab-0000-7000-8000-000000000002');
    expect(html).not.toContain('/frames/019823ab-0000-7000-8000-000000000001');
    expect(html).toContain(`>${REPLAY_COPY.play}<`);
  });

  it('never substitutes the first record image for an unavailable requested inspection', () => {
    const html = render({ initialSelection: { kind: 'unavailable', frameIndex: null } });
    expect(html).toContain('The requested inspection is not available in this Replay view.');
    expect(html).toContain('No selected frame');
    expect(html).not.toContain('/frames/');
    expect(html).not.toContain('ls-scrubber-pill--current');
    expect(html).not.toContain(REPLAY_COPY.noFrames);
    expect(html).not.toContain(REPLAY_COPY.observationsNoFrame);
  });

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
    expect(html).toContain('Frame 2 of 3: Opening the record for E-000102 on LoanCore');
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
      { kind: 'work-item', id: 'w1', label: 'Leaver 1', frameIndex: 0, absence: null },
      { kind: 'work-item', id: 'w2', label: 'Adapter read', frameIndex: null, absence: 'none-captured' },
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

describe('a jump target with no frame to open', () => {
  const missing = (absence: ReplayJumpTarget['absence'] & string): ReplayJumpTarget =>
    ({ kind: 'work-item', id: 'w-late', label: 'Leaver 9', frameIndex: null, absence });

  it('says no frame was captured when the resolver decided that', () => {
    const html = render({ framesTotal: 3, jumpTargets: [missing('none-captured')] });
    expect(html).toContain(REPLAY_COPY.noFrameForTarget);
    expect(html).not.toContain('frames shown');
  });

  it('says only that no frame is among those shown when the read bound -- neither that one exists nor that none was captured', () => {
    // The frame read bounds at `REPLAY_FRAME_LIMIT`. Past it, a Work Item's null index has
    // TWO possible reasons and the page cannot tell them apart; the resolver says so with
    // `not-read`, and this row must claim no more than that. A first version inferred "its
    // frame is beyond the frames shown" from the global count, which was a false statement
    // about a Work Item that captured nothing in a long Run.
    const html = render({ framesTotal: 500, jumpTargets: [missing('not-read')] });
    expect(html).toContain(REPLAY_COPY.frameNotRead.replace('{shown}', '3'));
    expect(html).not.toContain(REPLAY_COPY.noFrameForTarget);
    expect(html).not.toContain('beyond');
  });

  it('says no frame preceded an Escalation, whatever the bound', () => {
    const target: ReplayJumpTarget = { kind: 'escalation', id: 'w1', label: 'Choose candidate', frameIndex: null, absence: 'none-before' };
    const html = render({ framesTotal: 500, jumpTargets: [target] });
    expect(html).toContain(REPLAY_COPY.noFrameBeforeTarget);
    expect(html).not.toContain(REPLAY_COPY.frameNotRead.replace('{shown}', '3'));
  });
});

describe('where Replay sends a reader for the Observations', () => {
  it('links to the Evidence tab, which is the surface that lists them', () => {
    // It linked to `/runs/<id>/observations`, which is not one of the five Run Detail tabs
    // and answered Page not found — a dead end on the one control that offers to show the
    // records this session produced (owner review, 2026-09-16).
    const html = render();
    expect(html).toContain(`href="/runs/${RUN_ID}/evidence"`);
    expect(html).not.toContain(`/runs/${RUN_ID}/observations`);
    expect(html).toContain(REPLAY_COPY.observationsLink);
    expect(REPLAY_COPY.observationsLink).toContain('Evidence tab');
  });

  it('counts Observations against a frame only when there IS a frame', () => {
    // With no frame this said "0 Observations had been registered when this frame was
    // captured", which describes a frame that does not exist — an absence dressed as a
    // measurement.
    const empty = render({ frames: [], framesTotal: 0 });
    expect(empty).toContain(REPLAY_COPY.observationsNoFrame);
    expect(empty).not.toContain('when this frame was captured');
    // The link is still offered: the Run may hold Observations even with no frame at all.
    expect(empty).toContain(`href="/runs/${RUN_ID}/evidence"`);
  });

  it('still counts them for the frame the viewer is showing', () => {
    const html = render({ frames: [frameView(2)], framesTotal: 1 });
    expect(html).toContain(REPLAY_COPY.observationsThrough.replace('{count}', '2 Observations'));
    expect(html).not.toContain(REPLAY_COPY.observationsNoFrame);
  });
});

// UI cleanup 2026-09-22, UX-29 and UX-27. The playback controls and the scrubber were under
// the stage, past the first viewport at 1366x768 because the stage keeps its 430px floor.
// They are at the top of the rail, BESIDE the screen, before anything else the rail says;
// the browser test in `replay.spec.ts` measures where they actually land.
describe('the playback controls sit beside the screen (UX-29)', () => {
  it('puts the controls and the scrubber at the top of the rail, after the stage', () => {
    const html = render();
    const stage = html.indexOf('ls-session__stage');
    const rail = html.indexOf('ls-session__rail');
    const controls = html.indexOf('ls-session__controls');
    const scrubber = html.indexOf('ls-session__scrubber');
    const narration = html.indexOf('What the Agent was doing');
    expect(stage).toBeGreaterThan(-1);
    expect([stage, rail, controls, scrubber, narration]).toEqual([stage, rail, controls, scrubber, narration].sort((a, b) => a - b));
  });

  it('says the policy sentence once, above the location and the address the Agent asked for', () => {
    const html = render();
    expect(html.split('Untrusted source content —').length - 1).toBe(2);
    expect(html.split(UNTRUSTED_CONTENT_SENTENCE).length - 1).toBe(1);
  });
});

// Story 10.6 (legacy 5.3): Replay and Live View render the adapter log through ONE
// component, so a repair can no longer land on one surface only — which is how Replay's
// rows came to show their digests while Live View's said "No artifact registered."
describe('the adapter log, shared with Live View', () => {
  it('names the registered Evidence and says the other two situations in their own words', () => {
    const evidenceId = '019823ab-0000-7000-8000-0000000000e1';
    const html = render({
      adapterSteps: [
        { stepId: 'session-2', displayName: 'Extract · RoleMatrix', state: 'ACQUIRED', attempts: 1,
          artifact: { kind: 'registered', evidenceId, digest: 'e'.repeat(64) } },
        { stepId: 'session-3', displayName: 'Extract · AccessGate', state: 'FAILED', attempts: 3, artifact: { kind: 'none' } },
        { stepId: 'session-4', displayName: 'Extract · CoreDirectory', state: 'ACQUIRED', attempts: 1,
          artifact: { kind: 'unavailable' } },
      ],
    });
    expect(html).toContain('id="replay-adapter-heading"');
    expect(html).toContain('e'.repeat(64));
    expect(html).toContain(`#evidence-${evidenceId}`);
    expect(html).toContain(ADAPTER_ARTIFACT_WORDS.none);
    expect(html).toContain(ADAPTER_ARTIFACT_WORDS.unavailable);
  });
});
