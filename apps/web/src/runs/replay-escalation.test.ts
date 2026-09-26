import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { RunFrameRow, RunReplayWait } from '@intellifin/infrastructure';

import { REPLAY_COPY } from '../design/copy';
import { ESCALATION_REPLAY_WORDS } from './decision-words';
import { ReplayViewer, type ReplayFrameView } from './ReplayViewer';
import {
  replayEscalationSelection,
  replayInitialSelection,
  replayJumpTargets,
  replaySelectionKey,
  replayViewerKey,
  type ReplayInitialSelection,
} from './replay';

/**
 * Replay opened from a Timeline entry's "Open in Replay" (Story 10.10): the Escalation's
 * own jump target, resolved only against THIS Run's stored targets, and said in words
 * when it cannot be — never a guessed frame.
 */

const RUN = '019823ab-0000-7000-8000-000000000001';
const WORK = '019823ab-0000-7000-8000-0000000000a1';
const EARLY = '019823ab-0000-7000-8000-0000000000e1';
const RAISED = '019823ab-0000-7000-8000-0000000000e2';
const PAUSED = '019823ab-0000-7000-8000-0000000000e3';

function frame(at: string, index: number): RunFrameRow {
  return {
    evidenceId: `019823ab-0000-7000-8000-00000000000${index}`,
    toolActionId: '019823ab-0000-7000-8000-0000000000f1',
    stepExecutionId: '019823ab-0000-7000-8000-0000000000f2',
    workItemId: WORK,
    action: 'read-attribute',
    digest: 'a'.repeat(64),
    size: 128,
    mediaType: 'image/png',
    sourceLocation: 'https://synthetic.invalid/page',
    capturedAt: at,
    actionStartedAt: at,
  };
}

const FRAMES = [frame('2026-09-10T09:00:00.000Z', 1), frame('2026-09-10T09:01:00.000Z', 2), frame('2026-09-10T09:02:00.000Z', 3)];

function wait(waitId: string, openedAt: string, kind: RunReplayWait['kind'] = 'retry-or-skip'): RunReplayWait {
  return { waitId, kind, openedAt, closedAt: null, closureKind: null, answerOptionId: null };
}

const TARGETS = replayJumpTargets({
  frames: FRAMES,
  framesTotal: FRAMES.length,
  workItems: [{ workItemId: WORK, displayName: 'LoanCore', subjectKey: 'E-000102' }],
  exceptions: [],
  waits: [
    // Raised before any frame was captured: a target with nowhere to go.
    wait(EARLY, '2026-09-10T08:59:00.000Z'),
    // Raised after the second frame: the last frame captured before it.
    wait(RAISED, '2026-09-10T09:01:30.000Z', 'choose-candidate'),
    // A pause is a wait that asks nothing, and never a jump target.
    wait(PAUSED, '2026-09-10T09:01:45.000Z', 'pause'),
  ],
});

describe('where Replay opens for an answered Escalation', () => {
  it('opens at the Escalation’s own jump target, case-insensitively', () => {
    expect(replayEscalationSelection(RAISED, TARGETS)).toMatchObject({ kind: 'escalation', frameIndex: 1, target: { id: RAISED, label: 'Choose candidate' } });
    expect(replayEscalationSelection(RAISED.toUpperCase(), TARGETS)).toMatchObject({ kind: 'escalation', frameIndex: 1 });
  });

  it('keeps a target with no frame, so the viewer can say why rather than show another screen', () => {
    expect(replayEscalationSelection(EARLY, TARGETS)).toMatchObject({ kind: 'escalation', frameIndex: null, target: { absence: 'none-before' } });
  });

  it('refuses anything that is not one of this Run’s Escalations: malformed, repeated, a pause, a Work Item, another Run’s', () => {
    for (const value of ['not-a-uuid', [RAISED, RAISED], PAUSED, WORK, '019823ab-0000-7000-8000-0000000000ff', '']) {
      expect(replayEscalationSelection(value, TARGETS)).toEqual({ kind: 'escalation-unavailable', frameIndex: null });
    }
  });

  it('changes nothing when no Escalation was asked for', () => {
    expect(replayEscalationSelection(undefined, TARGETS)).toBeNull();
    expect(replayInitialSelection(undefined, TARGETS, FRAMES.length)).toEqual({ kind: 'start', frameIndex: 0 });
  });

  it('keys the viewer by the selection too, so another Escalation starts at its own frame', () => {
    const request = { kind: 'prefix' } as const;
    const start: ReplayInitialSelection = { kind: 'start', frameIndex: 0 };
    expect(replaySelectionKey(RUN, request, start)).toBe(replayViewerKey(RUN, request));
    const keys = [
      replaySelectionKey(RUN, request, start),
      replaySelectionKey(RUN, request, replayEscalationSelection(RAISED, TARGETS)!),
      replaySelectionKey(RUN, request, replayEscalationSelection(EARLY, TARGETS)!),
      replaySelectionKey(RUN, request, { kind: 'escalation-unavailable', frameIndex: null }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    // A re-read of the same selection is the same key, so the reader keeps their frame.
    expect(replaySelectionKey(RUN, request, replayEscalationSelection(RAISED, TARGETS)!))
      .toBe(replaySelectionKey(RUN, request, replayEscalationSelection(RAISED.toUpperCase(), TARGETS)!));
  });
});

function view(index: number): ReplayFrameView {
  return {
    evidenceId: `019823ab-0000-7000-8000-00000000000${index}`,
    narration: `Opening the record for E-000102 on LoanCore (${index})`,
    stepNarration: `Opening the record for E-000102 on LoanCore (${index})`,
    workItemId: WORK,
    subjectKey: 'E-000102',
    sourceLocation: 'https://synthetic.invalid/page',
    digest: 'a'.repeat(64),
    capturedAt: `2026-09-10T09:0${index}:00.000Z`,
    workItemLabel: 'E-000102',
    action: null,
    observations: index,
  };
}

function render(initialSelection: ReplayInitialSelection): string {
  return renderToStaticMarkup(React.createElement(ReplayViewer, {
    runId: RUN,
    runState: 'CANCELED',
    stateSentence: 'Session REPLAY. This Run ended: CANCELED.',
    workspace: null,
    frames: [view(1), view(2), view(3)],
    framesTotal: 3,
    plannedSteps: 4,
    stageNote: REPLAY_COPY.noFrames,
    jumpTargets: TARGETS,
    initialSelection,
    instructions: [],
    adapterSteps: [],
  }));
}

describe('what Replay says when an answered Escalation opened it', () => {
  it('opens paused on the Escalation’s frame and says which Escalation it opened at', () => {
    const html = render(replayEscalationSelection(RAISED, TARGETS)!);
    expect(html).toContain('Frame 2 of 3');
    expect(html).toContain('/frames/019823ab-0000-7000-8000-000000000002');
    expect(html).toContain(`>${REPLAY_COPY.play}<`);
    expect(html).toContain(ESCALATION_REPLAY_WORDS.opened.replace('{kind}', 'Choose candidate'));
  });

  it('shows no frame for an Escalation with none before it, and says so in the resolver’s words', () => {
    const html = render(replayEscalationSelection(EARLY, TARGETS)!);
    expect(html).toContain('No selected frame');
    expect(html).not.toContain('ls-scrubber-pill--current');
    expect(html).toContain(`Opened for the Escalation “Retry or skip”: ${REPLAY_COPY.noFrameBeforeTarget}. Choose a recorded target below.`);
  });

  it('never substitutes another screen for an Escalation it cannot resolve', () => {
    const html = render({ kind: 'escalation-unavailable', frameIndex: null });
    expect(html).toContain(ESCALATION_REPLAY_WORDS.unavailable);
    expect(html).toContain('No selected frame');
    expect(html).not.toContain('/frames/');
    expect(html).not.toContain('The requested inspection is not available');
  });
});
