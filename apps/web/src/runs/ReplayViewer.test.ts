import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { REPLAY_COPY, UNTRUSTED_CONTENT_SENTENCE } from '../design/copy';
import { ReplayViewer, type ReplayFrameView } from './ReplayViewer';
import { REPLAY_BOUND_WORDS, REPLAY_GAP_WORDS, replayGapPosition, replayIncompleteSentence, type ReplayGapsView, type ReplayJumpTarget } from './replay';
import { ADAPTER_ARTIFACT_WORDS } from './live-view';
import { captureSentence } from './labels';

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
    jumpTotals: { escalations: 0, exceptions: 0 },
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

/**
 * A bounded jump list says what it covers, before it lists anything (Story 10.9). The page
 * reads the first `REPLAY_PAGE_SIZE` Escalations and Exceptions; this list used to stop
 * there and read as every one the Run raised.
 */
describe('a bounded jump list says what it covers (Story 10.9)', () => {
  const WORK = '019823ab-0000-7000-8000-0000000000c9';
  const escalation = (id: string): ReplayJumpTarget => ({ kind: 'escalation', id, label: 'Choose candidate', frameIndex: 0, absence: null });
  const exception = (id: string): ReplayJumpTarget => ({ kind: 'exception', id, label: 'E-000105', frameIndex: 1, absence: null });
  const [restBefore, restAfter] = REPLAY_BOUND_WORDS.rest.split(REPLAY_BOUND_WORDS.restLink);
  const rest = `${restBefore}<a href="/runs/${RUN_ID}/evidence">${REPLAY_BOUND_WORDS.restLink}</a>${restAfter}`;

  it('states each bounded kind with the exact totals, and links the way to the rest', () => {
    const html = render({ jumpTargets: [escalation('w1'), escalation('w2'), exception('e1')],
      jumpTotals: { escalations: 612, exceptions: 1_204 } });
    expect(html).toContain('Showing the first 2 of 612 Escalations.');
    expect(html).toContain('Showing the first 1 of 1,204 Exceptions.');
    // The owner's sentence, word for word; only "record review" is a link.
    expect(html).toContain(rest);
  });

  it('says it BEFORE the list, so a reader knows the list is partial before reading it', () => {
    const html = render({ jumpTargets: [escalation('w1')], jumpTotals: { escalations: 900, exceptions: 0 } });
    expect(html.indexOf('Showing the first 1 of 900 Escalations.')).toBeGreaterThan(html.indexOf('Jump to'));
    expect(html.indexOf('Showing the first 1 of 900 Escalations.')).toBeLessThan(html.indexOf('ls-session__jumps'));
  });

  it('names only the kind that is bounded', () => {
    const html = render({ jumpTargets: [escalation('w1'), exception('e1')], jumpTotals: { escalations: 1, exceptions: 700 } });
    expect(html).toContain('Showing the first 1 of 700 Exceptions.');
    expect([...html.matchAll(/Showing the first/g)]).toHaveLength(1);
  });

  it('says nothing when the list names every one, which is every Run under the bound', () => {
    const html = render({ jumpTargets: [escalation('w1'), exception('e1')], jumpTotals: { escalations: 1, exceptions: 1 } });
    expect(html).not.toContain('Showing the first');
    expect(html).not.toContain(restBefore!);
  });

  it('counts what the list RENDERS, so the sentence describes the list under it', () => {
    // Two Escalations listed of three: the shown number comes from the targets, never from
    // a figure handed in beside them.
    const html = render({ jumpTargets: [escalation('w1'), escalation('w2')], jumpTotals: { escalations: 3, exceptions: 0 } });
    expect(html).toContain('Showing the first 2 of 3 Escalations.');
  });

  it('never says a bounded Run recorded nothing to jump to', () => {
    const html = render({ jumpTargets: [], jumpTotals: { escalations: 5, exceptions: 0 } });
    expect(html).not.toContain(REPLAY_COPY.noJumpTargets);
    expect(html).toContain('Showing the first 0 of 5 Escalations.');
    // Under the bound, an empty list still says the Run recorded nothing.
    expect(render({ jumpTargets: [], jumpTotals: { escalations: 0, exceptions: 0 } })).toContain(REPLAY_COPY.noJumpTargets);
  });

  it('opens an Escalation it did not read at the inspection page that holds its frame', () => {
    const target: ReplayJumpTarget = { kind: 'escalation', id: 'w-late', label: 'Choose candidate', workItemId: WORK,
      inspectionCursor: 500, frameIndex: null, absence: 'not-read' };
    const html = render({ framesTotal: 900, jumpTargets: [target], jumpTotals: { escalations: 1, exceptions: 0 } });
    expect(html).toContain(REPLAY_COPY.frameNotRead.replace('{shown}', '3'));
    expect(html).toContain(`href="/runs/${RUN_ID}/replay?workItem=${WORK}&amp;cursor=500"`);
  });

  it('keeps the first inspection page for a target whose frame is its record’s first', () => {
    const target: ReplayJumpTarget = { kind: 'exception', id: 'e-late', label: 'E-000901', workItemId: WORK,
      frameIndex: null, absence: 'not-read' };
    const html = render({ framesTotal: 900, jumpTargets: [target], jumpTotals: { escalations: 0, exceptions: 1 } });
    expect(html).toContain(`href="/runs/${RUN_ID}/replay?workItem=${WORK}"`);
  });

  it('says nothing about bounds on one record’s inspection, which lists no jump targets', () => {
    const html = render({ jumpTargets: [], jumpTotals: null,
      window: { kind: 'inspection', workItemId: WORK, label: 'E-000901 · LoanCore', total: 3, cursor: 0, previousCursor: null, nextCursor: null } });
    expect(html).not.toContain('Showing the first');
    expect(html).not.toContain('Jump to');
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

// Story 10.6 (legacy 5.2): a session with a gap looked complete. A missing frame is marked
// where it sits and counted; a suppressed capture is marked in the platform's own capture
// sentence and is NEVER counted as missing. Every sentence is read back from its module.
describe('the gaps in a playback (Story 10.6, legacy 5.2)', () => {
  const suppressedMark = captureSentence('SUPPRESSED', 'credential-entry');
  const gaps: ReplayGapsView = {
    missing: 1,
    suppressed: 1,
    rows: [
      { toolActionId: 'gap-suppressed', kind: 'suppressed', mark: suppressedMark, narration: 'Signing in to LoanCore', framesBefore: 0 },
      { toolActionId: 'gap-missing', kind: 'missing', mark: REPLAY_GAP_WORDS.missing, narration: 'Opening the record for E-000102 on LoanCore', framesBefore: 2 },
    ],
  };

  it('states that playback is incomplete with the count of MISSING frames only', () => {
    const html = render({ gaps });
    expect(html).toContain(replayIncompleteSentence(1));
    // Two gaps are listed, and only one is missing: the suppressed capture is not counted.
    expect(html).not.toContain(replayIncompleteSentence(2));
    expect(html).toContain(REPLAY_GAP_WORDS.heading);
  });

  it('marks each gap where it sits on the scrubber, as a named image and never a button', () => {
    const html = render({ gaps });
    const scrubber = html.match(/<div class="ls-session__scrubber"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    // The suppressed capture sits before the first frame; the missing frame after frame 2.
    const missing = `${REPLAY_GAP_WORDS.missing}, ${replayGapPosition(2)}: Opening the record for E-000102 on LoanCore`;
    const suppressed = `${suppressedMark}, ${replayGapPosition(0)}: Signing in to LoanCore`;
    expect(scrubber).toContain(`class="ls-scrubber-gap ls-scrubber-gap--missing" role="img" aria-label="${missing}"`);
    expect(scrubber).toContain(`class="ls-scrubber-gap ls-scrubber-gap--suppressed" role="img" aria-label="${suppressed}"`);
    // In session order: the suppressed marker, frame 1, frame 2, the missing marker, frame 3.
    const order = [...scrubber.matchAll(/class="(ls-scrubber-gap ls-scrubber-gap--[a-z]+|ls-scrubber-pill[^"]*)"/g)]
      .map((match) => (match[1]!.startsWith('ls-scrubber-gap') ? match[1]!.split('--')[1] : 'frame'));
    expect(order).toEqual(['suppressed', 'frame', 'frame', 'missing', 'frame']);
    expect(scrubber.match(/<button/g)).toHaveLength(3);
  });

  it('lists each gap in words, the suppressed one in the platform’s capture sentence', () => {
    const html = render({ gaps });
    expect(html).toContain(`${REPLAY_GAP_WORDS.missing} · ${replayGapPosition(2)} · Opening the record for E-000102 on LoanCore`);
    expect(html).toContain(`${suppressedMark} · ${replayGapPosition(0)} · Signing in to LoanCore`);
    expect(suppressedMark).toBe('Capture suppressed — a credential was presented on this request');
  });

  it('says nothing about gaps a Run did not have', () => {
    for (const html of [render(), render({ gaps: { missing: 0, suppressed: 0, rows: [] } })]) {
      expect(html).not.toContain(REPLAY_GAP_WORDS.heading);
      expect(html).not.toContain('ls-scrubber-gap');
      expect(html).not.toContain('Playback is incomplete');
    }
  });

  it('keeps suppressed captures out of the incomplete statement entirely', () => {
    const html = render({ gaps: { missing: 0, suppressed: 1, rows: [gaps.rows[0]!] } });
    expect(html).toContain(REPLAY_GAP_WORDS.heading);
    expect(html).toContain(suppressedMark);
    expect(html).not.toContain('Playback is incomplete');
  });

  it('says when the list of positions is bounded, against the exact totals', () => {
    const html = render({ gaps: { missing: 150, suppressed: 3, rows: gaps.rows } });
    expect(html).toContain(replayIncompleteSentence(150));
    expect(html).toContain(REPLAY_GAP_WORDS.bounded.replace('{shown}', '2').replace('{total}', '153'));
  });
});
