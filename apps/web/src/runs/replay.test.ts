import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { RunFrameRow, RunReplayGaps, RunReplayObservationDelta, RunReplayWait } from '@intellifin/infrastructure';

import { ESCALATION_KIND_UNKNOWN } from '../design/plain-words';
import { captureSentence } from './labels';

import {
  REPLAY_BOUND_WORDS,
  REPLAY_GAP_WORDS,
  REPLAY_JUMP_KINDS,
  REPLAY_RECORD_GAP_WORDS,
  clampReplayIndex,
  replayGapPosition,
  replayGapsAt,
  replayGapsView,
  replayIncompleteSentence,
  replayRecordIncompleteSentence,
  replayFrameAt,
  replayFrameForWorkItem,
  replayInitialSelection,
  replayJumpBoundSentence,
  replayJumpTargets,
  resolveFrameWorkItems,
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

/**
 * A wait, placed in the WHOLE session the way the repository places it (Story 10.9): by
 * default the session is `FRAMES`, so `framesThrough` counts its frames at or before the
 * instant, and the landing names the Work Item of the last of them.
 */
function wait(overrides: Partial<RunReplayWait> & { readonly waitId: string; readonly openedAt: string }): RunReplayWait {
  const at = Date.parse(overrides.openedAt);
  const through = FRAMES.filter((item) => Date.parse(item.actionStartedAt) <= at);
  const last = through.at(-1);
  return {
    kind: 'choose-candidate', closedAt: null, closureKind: null, answerOptionId: null,
    framesThrough: through.length, landedBy: 'raised-at',
    landing: last?.workItemId == null ? null : { workItemId: last.workItemId, cursor: 0 },
    ...overrides,
  };
}

describe('where a Replay jump lands', () => {
  it('anchors a record deep link to its same-Run stored inspection rather than frame zero', () => {
    const targets = replayJumpTargets({ frames: FRAMES, framesTotal: 4,
      workItems: [{ workItemId: WORK_B, displayName: 'LoanCore', subjectKey: 'E-2' }], exceptions: [], waits: [] });
    expect(replayInitialSelection(WORK_B.toUpperCase(), targets, 4)).toMatchObject({ kind: 'inspection', frameIndex: 2 });
    expect(replayInitialSelection(undefined, targets, 4)).toEqual({ kind: 'start', frameIndex: 0 });
    for (const value of [WORK_A, '', 'not-an-id', [WORK_B, WORK_A]])
      expect(replayInitialSelection(value, targets, 4)).toEqual({ kind: 'unavailable', frameIndex: null });
  });

  it('keeps a requested bounded-out capture unavailable without claiming none was captured', () => {
    const targets = replayJumpTargets({ frames: FRAMES.slice(0, 2), framesTotal: 4,
      workItems: [{ workItemId: WORK_B, displayName: 'LoanCore', subjectKey: 'E-2' }], exceptions: [], waits: [] });
    expect(replayInitialSelection(WORK_B, targets, 2)).toMatchObject({
      kind: 'inspection', frameIndex: null, target: { absence: 'not-read' },
    });
  });

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
    framesTotal: FRAMES.length,
    frames: FRAMES,
    workItems: [
      { workItemId: WORK_A, displayName: 'LoanCore', subjectKey: 'E-000102' },
      { workItemId: WORK_B, displayName: 'LoanCore', subjectKey: 'E-000105' },
      { workItemId: '019823ab-0000-7000-8000-0000000000c1', displayName: 'ProdConsole', subjectKey: null },
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

  // A P-4 page raises every Exception against ONE frame. Ordered by identifier (a hash),
  // they were listed in no order a reader could see, and a bounded list's "first N" did not
  // start at its top. Ties keep the order the read returned: raised first, first listed.
  it('keeps the order each read returned where targets land on one frame (Story 10.9)', () => {
    const tied = replayJumpTargets({
      frames: FRAMES,
      framesTotal: FRAMES.length,
      workItems: [],
      exceptions: [
        { exceptionId: 'ffff', workItemId: WORK_B, populationRecordKey: 'raised-first' },
        { exceptionId: 'aaaa', workItemId: WORK_B, populationRecordKey: 'raised-second' },
        { exceptionId: 'cccc', workItemId: WORK_B, populationRecordKey: 'raised-third' },
      ],
      waits: [
        wait({ waitId: 'w-z', openedAt: '2026-09-10T09:02:10.000Z' }),
        wait({ waitId: 'w-a', openedAt: '2026-09-10T09:02:20.000Z' }),
      ],
    });
    expect(tied.map((target) => [target.kind, target.frameIndex, target.id])).toEqual([
      ['exception', 2, 'ffff'],
      ['exception', 2, 'aaaa'],
      ['exception', 2, 'cccc'],
      ['escalation', 2, 'w-z'],
      ['escalation', 2, 'w-a'],
    ]);
  });

  // `displayName` is the TARGET SYSTEM's name and is the SAME on every Work Item of a
  // Run, so labelling a jump with it gave a three-leaver Run three pills reading
  // "LoanCore" — on the surface a reader follows from a captured screen to a conclusion,
  // and beside an Exception pill that already named its record.
  it('leads a Work Item jump with the record, and names the system beside it', () => {
    const items = targets.filter((target) => target.kind === 'work-item').map((target) => target.label);
    expect(items).toEqual(['E-000102 · LoanCore', 'E-000105 · LoanCore', 'ProdConsole']);
    expect(new Set(items).size).toBe(items.length);
  });

});

describe('why a jump target has no frame, said only as far as the read knows (PR 36 review)', () => {
  const WORK_C = '019823ab-0000-7000-8000-0000000000c1';
  const targets = (framesTotal: number) => replayJumpTargets({
    frames: FRAMES,
    framesTotal,
    workItems: [{ workItemId: WORK_A, displayName: 'LoanCore', subjectKey: 'E-000102' }, { workItemId: WORK_C, displayName: 'LoanCore', subjectKey: 'E-000107' }],
    exceptions: [],
    waits: [wait({ waitId: 'w-early', openedAt: '2026-09-10T08:59:00.000Z' })],
  });
  const of = (framesTotal: number, id: string) => targets(framesTotal).find((target) => target.id === id)!;

  it('a target that lands on a frame carries no reason', () => {
    expect(of(FRAMES.length, WORK_A)).toMatchObject({ frameIndex: 0, absence: null });
  });

  it('a Work Item with no frame among a COMPLETE read captured none', () => {
    expect(of(FRAMES.length, WORK_C)).toMatchObject({ frameIndex: null, absence: 'none-captured' });
  });

  it('a Work Item with no frame among a BOUNDED read is only "not read": the page cannot know more', () => {
    // Its frames may all lie past the bound, or it may have captured nothing; the read holds
    // the earliest frames and cannot tell. Inferring "beyond the read" here was the defect.
    expect(of(FRAMES.length + 1, WORK_C)).toMatchObject({ frameIndex: null, absence: 'not-read' });
  });

  it('an Escalation raised before the first frame has none before it, even when the read bound', () => {
    // The frames read are the EARLIEST, so none of them preceding the instant means none
    // at all does -- decidable under any bound, and never "not read".
    expect(of(FRAMES.length, 'w-early')).toMatchObject({ frameIndex: null, absence: 'none-before' });
    expect(of(FRAMES.length + 1, 'w-early')).toMatchObject({ frameIndex: null, absence: 'none-before' });
  });
});

/**
 * An Escalation whose frame the page never read (Story 10.9). The page reads the first
 * `REPLAY_FRAME_LIMIT` frames; where an Escalation lands is decided over EVERY frame, and a
 * landing past the frames read used to fall back to the last frame read -- a screen
 * captured before the question, which the question was not about.
 */
describe('an Escalation whose frame lies past the frames read (Story 10.9)', () => {
  // The session holds eight frames and the page read the first four (`FRAMES`).
  const late = (landing: RunReplayWait['landing']) => replayJumpTargets({
    frames: FRAMES, framesTotal: 8, workItems: [], exceptions: [],
    waits: [wait({ waitId: 'w-late', openedAt: '2026-09-10T09:07:30.000Z', framesThrough: 7, landing })],
  })[0]!;

  it('is NOT READ, and never lands on the last frame the page happened to read', () => {
    expect(late({ workItemId: WORK_B, cursor: 0 })).toMatchObject({ kind: 'escalation', frameIndex: null, absence: 'not-read' });
  });

  it('names the inspection page that holds its frame, which need not be the first', () => {
    expect(late({ workItemId: WORK_B, cursor: 500 })).toMatchObject({ workItemId: WORK_B, inspectionCursor: 500 });
  });

  it('offers no inspection when its frame belongs to no record, and still says only "not read"', () => {
    const target = late(null);
    expect(target).toMatchObject({ frameIndex: null, absence: 'not-read' });
    expect(target.workItemId).toBeUndefined();
    expect(target.inspectionCursor).toBeUndefined();
  });

  it('lands on the last frame read when that IS the frame at or before it', () => {
    // Four frames at or before it, four read: the boundary is inside the page, not past it.
    const [target] = replayJumpTargets({ frames: FRAMES, framesTotal: 8, workItems: [], exceptions: [],
      waits: [wait({ waitId: 'w4', openedAt: '2026-09-10T09:03:30.000Z' })] });
    expect(target).toMatchObject({ frameIndex: 3, absence: null });
    expect(target?.inspectionCursor).toBeUndefined();
  });

  it('keeps the database landing when captures and the wait share a rendered millisecond', () => {
    // Stored instants can differ by microseconds. The repository preserves their ordering
    // in framesThrough, although each timestamp renders to the same JavaScript instant.
    const frames = [
      frame({ actionStartedAt: '2026-09-10T09:00:00.000Z' }),
      frame({ actionStartedAt: '2026-09-10T09:00:00.000Z' }),
    ];
    const [target] = replayJumpTargets({ frames, framesTotal: 2, workItems: [], exceptions: [],
      waits: [wait({ waitId: 'between-captures', openedAt: '2026-09-10T09:00:00.000Z', framesThrough: 1 })] });
    expect(target).toMatchObject({ frameIndex: 0, absence: null });
  });

  it('does not invent a preceding frame when the database found none in the same millisecond', () => {
    const frames = [frame({ actionStartedAt: '2026-09-10T09:00:00.000Z' })];
    const [target] = replayJumpTargets({ frames, framesTotal: 1, workItems: [], exceptions: [],
      waits: [wait({ waitId: 'before-capture', openedAt: '2026-09-10T09:00:00.000Z', framesThrough: 0, landing: null })] });
    expect(target).toMatchObject({ frameIndex: null, absence: 'none-before' });
  });

  it('changes nothing under the bound: the last frame at or before it, from the frames read', () => {
    const [target] = replayJumpTargets({ frames: FRAMES, framesTotal: FRAMES.length, workItems: [], exceptions: [],
      waits: [wait({ waitId: 'w1', openedAt: '2026-09-10T09:02:30.000Z' })] });
    expect(target).toMatchObject({ frameIndex: 2, absence: null });
    expect(target?.workItemId).toBeUndefined();
  });
});

/**
 * What a bounded jump list says (Story 10.9). The owner approved the wording on
 * 2026-09-26; the story file is where that approval is recorded, so the words are read
 * back from it rather than compared with a copy of themselves.
 */
describe('what a bounded jump list says (Story 10.9)', () => {
  const story = readFileSync(fileURLToPath(new URL(
    '../../../../_bmad-output/implementation-artifacts/10-9-replay-bounded-history-completeness-a-bounded-view-says-what.md',
    import.meta.url,
  )), 'utf8').replace(/\s+/g, ' ');

  it('is the owner’s approved wording, word for word', () => {
    for (const sentence of [REPLAY_BOUND_WORDS.escalations, REPLAY_BOUND_WORDS.exceptions, REPLAY_BOUND_WORDS.rest])
      expect(story).toContain(`"${sentence}"`);
    // The linked words occur ONCE, so the sentence splits around its link into two halves.
    expect(REPLAY_BOUND_WORDS.rest.split(REPLAY_BOUND_WORDS.restLink)).toHaveLength(2);
  });

  it('says the exact numbers when the list names fewer than the Run holds', () => {
    expect(replayJumpBoundSentence('escalation', 500, 612)).toBe('Showing the first 500 of 612 Escalations.');
    expect(replayJumpBoundSentence('exception', 500, 1_204)).toBe('Showing the first 500 of 1,204 Exceptions.');
  });

  it('says nothing when the list names every one, which is every Run under the bound', () => {
    expect(replayJumpBoundSentence('escalation', 3, 3)).toBeNull();
    expect(replayJumpBoundSentence('exception', 0, 0)).toBeNull();
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

describe('a frame whose Tool Action carries no Work Item id', () => {
  it('is matched through the Step Execution that captured it', () => {
    // `run_tool_action.work_item_id` is nullable. The page resolves the SYSTEM through the
    // Step Execution; the jump list used the raw column and said "no frame was captured
    // here" for a Work Item whose frames were all there.
    const orphan = { ...FRAMES[0]!, workItemId: null, stepExecutionId: 'se-x' };
    const resolved = resolveFrameWorkItems([orphan], [{ stepExecutionId: 'se-x', workItemId: WORK_A }]);
    expect(replayFrameForWorkItem(resolved, WORK_A)).toBe(0);
    expect(replayFrameForWorkItem([orphan], WORK_A)).toBeNull();
  });

  it('keeps a frame that already names its Work Item, and one nothing resolves', () => {
    const resolved = resolveFrameWorkItems(FRAMES, [{ stepExecutionId: 'nope', workItemId: null }]);
    expect(resolved).toEqual(FRAMES);
  });
});

describe('what a Replay jump row calls an Escalation', () => {
  it('names the question, never the stored key', () => {
    // The jump row renders its label in a MONOSPACE span, which presents whatever it is
    // given as an identifier. `choose-candidate` is a database value, not a question an
    // auditor asked -- the defect the plain-words pass removed from the authoring screens
    // and Replay reintroduced on a new surface.
    const [target] = replayJumpTargets({
    framesTotal: FRAMES.length,
      frames: FRAMES,
      workItems: [],
      exceptions: [],
      waits: [wait({ waitId: 'w1', openedAt: '2026-09-10T09:01:30.000Z' })],
    });
    expect(target?.label).toBe('Choose candidate');
    expect(target?.label).not.toBe('choose-candidate');
  });

  it('names an unrecognised stored kind rather than printing it', () => {
    const [target] = replayJumpTargets({
    framesTotal: FRAMES.length,
      frames: FRAMES,
      workItems: [],
      exceptions: [],
      waits: [wait({ waitId: 'w1', openedAt: '2026-09-10T09:01:30.000Z', kind: 'constructor' as RunReplayWait['kind'] })],
    });
    expect(target?.label).toBe(ESCALATION_KIND_UNKNOWN);
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

/**
 * The gaps in a Replay, in words (Story 10.6, legacy 5.2). A session with a gap looked
 * complete, because nothing said an action had left no frame.
 */
describe('the gaps in a playback (Story 10.6, legacy 5.2)', () => {
  it('states the limitation with the EXACT count, singular and plural', () => {
    expect(replayIncompleteSentence(1)).toBe('Playback is incomplete: 1 frame is missing.');
    expect(replayIncompleteSentence(2)).toBe('Playback is incomplete: 2 frames are missing.');
    expect(replayIncompleteSentence(12_345)).toBe('Playback is incomplete: 12,345 frames are missing.');
  });

  it('says where a gap sits in the scrubber’s own numbering', () => {
    expect(replayGapPosition(0)).toBe('before the first frame');
    expect(replayGapPosition(3)).toBe('after frame 3');
    expect(replayGapPosition(1_200)).toBe('after frame 1,200');
  });

  it('puts each gap at exactly one scrubber position', () => {
    const markers = [
      { toolActionId: 'a', kind: 'suppressed' as const, mark: 'Capture suppressed', narration: 'Signing in', framesBefore: 0, position: 0 },
      { toolActionId: 'b', kind: 'missing' as const, mark: REPLAY_GAP_WORDS.missing, narration: 'Opening a page', framesBefore: 2, position: 2 },
      { toolActionId: 'c', kind: 'missing' as const, mark: REPLAY_GAP_WORDS.missing, narration: 'Reading a field', framesBefore: 2, position: 2 },
    ];
    const gaps = { scope: 'session' as const, missing: 2, suppressed: 1, rows: markers, markers };
    expect(replayGapsAt(gaps, 0).map((gap) => gap.toolActionId)).toEqual(['a']);
    expect(replayGapsAt(gaps, 1)).toEqual([]);
    expect(replayGapsAt(gaps, 2).map((gap) => gap.toolActionId)).toEqual(['b', 'c']);
    expect(replayGapsAt(undefined, 0)).toEqual([]);
  });

  // Story 10.12, item 1: the scrubber draws the MARKERS, every gap among the frames shown,
  // and never takes them from the bounded list. A list row past the frames shown draws
  // nothing; a marker the bounded list does not name is still drawn.
  it('marks from the gaps among the frames shown, not from the bounded list', () => {
    const row = (id: string, position: number) =>
      ({ toolActionId: id, kind: 'missing' as const, mark: REPLAY_GAP_WORDS.missing, narration: id, framesBefore: position, position });
    const gaps = { scope: 'session' as const, missing: 102, suppressed: 0, rows: [row('listed', 1)], markers: [row('past-the-list', 3)] };
    expect(replayGapsAt(gaps, 1)).toEqual([]);
    expect(replayGapsAt(gaps, 3).map((gap) => gap.toolActionId)).toEqual(['past-the-list']);
  });
});

// Story 10.12, item 2: the one-record Replay's gap words, approved by the owner on 2026-09-29
// and read back from the story file on disk, word for word.
describe('the one-record Replay’s gap words (Story 10.12, item 2)', () => {
  const story = readFileSync(fileURLToPath(new URL(
    '../../../../_bmad-output/implementation-artifacts/10-12-epic-10-owner-items-replay-gaps-escalation-links-and-bounded.md',
    import.meta.url,
  )), 'utf8');

  it('is the owner’s approved wording, verbatim', () => {
    expect(REPLAY_RECORD_GAP_WORDS.heading).toBe("Gaps in this record's playback");
    expect(REPLAY_RECORD_GAP_WORDS.otherPage).toBe(" · on another page of this record's frames");
    expect(replayRecordIncompleteSentence(1)).toBe('Playback of this record is incomplete: 1 frame is missing.');
    expect(replayRecordIncompleteSentence(2)).toBe('Playback of this record is incomplete: 2 frames are missing.');
    expect(replayRecordIncompleteSentence(1_234)).toBe('Playback of this record is incomplete: 1,234 frames are missing.');
    // And the same words as the story records them, so a reword fails here.
    expect(story).toContain(`\`${REPLAY_RECORD_GAP_WORDS.heading}\``);
    expect(story).toContain(`\`${REPLAY_RECORD_GAP_WORDS.otherPage}\``);
    expect(story).toContain(`\`${replayRecordIncompleteSentence(1)}\``);
    expect(story).toContain(`\`${replayRecordIncompleteSentence(2).replace('2', 'N')}\``);
  });
});

// One builder for the whole-session and the one-record Replay (Story 10.6, legacy 5.2; the
// one-record view by owner decision D2 b, 2026-09-29): the same words, the exact counts, and
// a marker only where the gap sits among the frames the view shows.
describe('the gaps a Replay view states', () => {
  const gap = (id: string, overrides: Partial<RunReplayGaps['rows'][number]> = {}): RunReplayGaps['rows'][number] => ({
    toolActionId: id, kind: 'missing', action: 'open-record', startedAt: '2026-09-29T00:00:00.000Z',
    stepExecutionId: 'step', workItemId: 'record', targetSystem: 'loancore', captureSuppression: null,
    framesBefore: 0, ...overrides,
  });
  const narrate = (row: RunReplayGaps['rows'][number]) => `narration of ${row.toolActionId}`;

  it('words a missing frame and a suppressed capture as the whole-session Replay does, with the exact counts', () => {
    const rows = [
      gap('lost', { framesBefore: 3 }),
      gap('sign-in', { kind: 'suppressed', captureSuppression: 'credential-entry', framesBefore: 0 }),
    ];
    const view = replayGapsView({ missing: 7, suppressed: 1, rows, window: rows }, narrate, { kind: 'session' });
    const words = [
      { toolActionId: 'lost', kind: 'missing', mark: REPLAY_GAP_WORDS.missing, narration: 'narration of lost', framesBefore: 3, position: 3 },
      { toolActionId: 'sign-in', kind: 'suppressed', mark: captureSentence('SUPPRESSED', 'credential-entry'),
        narration: 'narration of sign-in', framesBefore: 0, position: 0 },
    ];
    expect(view).toEqual({ scope: 'session', missing: 7, suppressed: 1, rows: words, markers: words });
  });

  // Story 10.12, item 1: the markers are the read's WINDOW, the gaps among the frames shown,
  // however many precede them in the bounded list.
  it('marks every gap among the frames shown, including one the bounded list does not name', () => {
    const listed = Array.from({ length: 100 }, (_, index) => gap(`listed-${index}`, { framesBefore: 1 }));
    const late = gap('late', { framesBefore: 400 });
    const view = replayGapsView({ missing: 101, suppressed: 0, rows: listed, window: [...listed, late] }, narrate, { kind: 'session' });
    expect(view.rows).toHaveLength(100);
    expect(view.rows.some((row) => row.toolActionId === 'late')).toBe(false);
    expect(replayGapsAt(view, 400).map((row) => row.toolActionId)).toEqual(['late']);
  });

  it('marks a record’s gap among that record’s frames on its page, and nowhere else', () => {
    const rows = [
      gap('before-page', { framesBefore: 40, recordFramesBefore: 99 }), // after the previous page's last frame
      gap('first', { framesBefore: 506, recordFramesBefore: 100 }), // before this page's first frame
      gap('inside', { framesBefore: 560, recordFramesBefore: 150 }),
      gap('at-end', { framesBefore: 700, recordFramesBefore: 200 }), // after this page's last frame
      gap('unplaced', { framesBefore: 10 }), // a read with no record numbering is never guessed
    ];
    const page = (last: boolean) => replayGapsView({ missing: 5, suppressed: 0, rows, window: rows }, narrate,
      { kind: 'record', cursor: 100, shown: 100, last });
    // A gap between two pages is marked once, at the start of the later page.
    expect(page(false).rows.map((row) => [row.toolActionId, row.position])).toEqual([
      ['before-page', null], ['first', 0], ['inside', 50], ['at-end', null], ['unplaced', null],
    ]);
    // After the last frame of the record, on its last page.
    expect(page(true).rows.find((row) => row.toolActionId === 'at-end')!.position).toBe(100);
    // Story 10.12, item 2 (owner, 2026-09-29): a position on the one-record view says where
    // the gap is among THIS record's frames, not across the session. It said the session's
    // numbering before, so a gap before the record's first frame read "after frame 4".
    expect(page(false).rows.map((row) => row.framesBefore)).toEqual([99, 100, 150, 200, 10]);
    expect(page(false).scope).toBe('record');
    // The markers are the gaps on this page only.
    expect(page(false).markers.map((row) => row.toolActionId)).toEqual(['first', 'inside']);
    // Every gap is still listed and counted, marked or not.
    expect(page(false).missing).toBe(5);
    expect(page(false).rows).toHaveLength(5);
  });

  it('marks a record with no retained frame at its only position', () => {
    const only = [gap('only', { framesBefore: 12, recordFramesBefore: 0 })];
    const view = replayGapsView({ missing: 1, suppressed: 0, rows: only, window: only },
      narrate, { kind: 'record', cursor: 0, shown: 0, last: true });
    expect(replayGapsAt(view, 0).map((row) => row.toolActionId)).toEqual(['only']);
  });
});
