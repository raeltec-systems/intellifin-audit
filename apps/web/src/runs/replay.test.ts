import { describe, expect, it } from 'vitest';

import type { RunFrameRow, RunReplayObservationDelta, RunReplayWait } from '@intellifin/infrastructure';

import {
  REPLAY_JUMP_KINDS,
  clampReplayIndex,
  replayFrameAt,
  replayFrameForWorkItem,
  replayJumpTargets,
  replayObservationsThrough,
} from './replay';

/**
 * Replay's alignment arithmetic (Story 5.8).
 *
 * The subject is where a jump LANDS, which is the one thing a reader cannot check for
 * themselves: a pill that opens the wrong screen looks exactly like a pill that opens the
 * right one.
 */

const WORK_A = '019823ab-0000-7000-8000-0000000000a1';
const WORK_B = '019823ab-0000-7000-8000-0000000000b1';

function frame(overrides: Partial<RunFrameRow> & { readonly actionStartedAt: string }): RunFrameRow {
  return {
    evidenceId: `019823ab-0000-7000-8000-${overrides.actionStartedAt.slice(-6).replace(/\D/g, '0').padStart(12, '0')}`,
    toolActionId: '019823ab-0000-7000-8000-0000000000f1',
    stepExecutionId: '019823ab-0000-7000-8000-0000000000f2',
    workItemId: WORK_A,
    action: 'read-attribute',
    digest: 'a'.repeat(64),
    size: 128,
    mediaType: 'image/png',
    sourceLocation: 'https://synthetic.invalid/page',
    capturedAt: overrides.actionStartedAt,
    ...overrides,
  };
}

const FRAMES: readonly RunFrameRow[] = [
  frame({ actionStartedAt: '2026-09-10T09:00:00.000Z', workItemId: WORK_A }),
  frame({ actionStartedAt: '2026-09-10T09:01:00.000Z', workItemId: WORK_A }),
  frame({ actionStartedAt: '2026-09-10T09:02:00.000Z', workItemId: WORK_B }),
  frame({ actionStartedAt: '2026-09-10T09:03:00.000Z', workItemId: WORK_B }),
];

function wait(overrides: Partial<RunReplayWait> & { readonly waitId: string; readonly openedAt: string }): RunReplayWait {
  return { kind: 'choose-candidate', closedAt: null, closureKind: null, answerOptionId: null, ...overrides };
}

describe('where a Replay jump lands', () => {
  it('takes a Work Item to its FIRST frame, so a jump starts at it', () => {
    expect(replayFrameForWorkItem(FRAMES, WORK_A)).toBe(0);
    expect(replayFrameForWorkItem(FRAMES, WORK_B)).toBe(2);
  });

  it('has nowhere to send a Work Item that captured nothing', () => {
    expect(replayFrameForWorkItem(FRAMES, '019823ab-0000-7000-8000-0000000000c1')).toBeNull();
    expect(replayFrameForWorkItem([], WORK_A)).toBeNull();
  });

  it('takes an Escalation to the last frame BEFORE it was raised', () => {
    // The page the question is about. A frame captured after it belongs to whatever
    // happened next, and jumping there would show a screen the question was not about.
    expect(replayFrameAt(FRAMES, '2026-09-10T09:02:30.000Z')).toBe(2);
    expect(replayFrameAt(FRAMES, '2026-09-10T09:02:00.000Z')).toBe(2);
    expect(replayFrameAt(FRAMES, '2026-09-10T09:01:59.999Z')).toBe(1);
    expect(replayFrameAt(FRAMES, '2026-09-10T23:00:00.000Z')).toBe(3);
  });

  it('says nothing rather than guessing when no frame precedes the wait', () => {
    expect(replayFrameAt(FRAMES, '2026-09-10T08:59:59.999Z')).toBeNull();
    expect(replayFrameAt(FRAMES, 'not an instant')).toBeNull();
    expect(replayFrameAt([], '2026-09-10T09:00:00.000Z')).toBeNull();
  });
});

describe('the Replay jump list', () => {
  const targets = replayJumpTargets({
    frames: FRAMES,
    workItems: [
      { workItemId: WORK_A, displayName: 'Leaver 1' },
      { workItemId: WORK_B, displayName: 'Leaver 2' },
      { workItemId: '019823ab-0000-7000-8000-0000000000c1', displayName: 'Adapter read' },
    ],
    exceptions: [{ exceptionId: 'e1', workItemId: WORK_B, populationRecordKey: 'E-000105' }],
    waits: [
      wait({ waitId: 'w1', openedAt: '2026-09-10T09:01:30.000Z' }),
      wait({ waitId: 'w2', kind: 'pause', openedAt: '2026-09-10T09:03:30.000Z' }),
    ],
  });

  it('reads in session order, with what cannot be reached last', () => {
    expect(targets.map((target) => [target.kind, target.frameIndex])).toEqual([
      ['work-item', 0],
      ['escalation', 1],
      ['work-item', 2],
      ['exception', 2],
      ['work-item', null],
    ]);
  });

  it('leaves a PAUSE out: it is a wait that asks nothing', () => {
    expect(targets.some((target) => target.id === 'w2')).toBe(false);
    expect(REPLAY_JUMP_KINDS).toEqual(['work-item', 'exception', 'escalation']);
  });

  it('labels an Exception by the record it was raised against', () => {
    expect(targets.find((target) => target.kind === 'exception')?.label).toBe('E-000105');
  });
});

describe('the Observation count beside a frame', () => {
  const deltas: readonly RunReplayObservationDelta[] = [
    { sequence: 4, occurredAt: '2026-09-10T09:00:30.000Z', workItemId: WORK_A, stepExecutionId: null, registered: 2 },
    { sequence: 9, occurredAt: '2026-09-10T09:02:30.000Z', workItemId: WORK_B, stepExecutionId: null, registered: 3 },
  ];

  it('counts only what was registered by the time the frame was captured', () => {
    expect(replayObservationsThrough(deltas, FRAMES[0]!)).toBe(0);
    expect(replayObservationsThrough(deltas, FRAMES[1]!)).toBe(2);
    expect(replayObservationsThrough(deltas, FRAMES[3]!)).toBe(5);
  });

  it('counts nothing for a frame that is not there', () => {
    expect(replayObservationsThrough(deltas, null)).toBe(0);
  });
});

describe('the Replay position', () => {
  it('stays inside the frames that exist', () => {
    expect(clampReplayIndex(-3, 4)).toBe(0);
    expect(clampReplayIndex(9, 4)).toBe(3);
    expect(clampReplayIndex(2.7, 4)).toBe(2);
    expect(clampReplayIndex(Number.NaN, 4)).toBe(0);
  });

  it('is nowhere at all when a Run captured no frames', () => {
    expect(clampReplayIndex(0, 0)).toBe(-1);
  });
});
