import type { RunFrameRow, RunReplayObservationDelta, RunReplayWait } from '@intellifin/infrastructure';

import { fillTemplate } from '../design/copy';
import { escalationKindWord } from '../design/plain-words';
import { workItemLabel } from './labels';

/**
 * Replay's presentation logic (Story 5.8, FR-30, UX-DR26, addendum §F).
 *
 * Every function here is PURE and every input is a row the platform already stored. That
 * is the shape of FR-30's rule rather than a style choice: Replay renders from the
 * platform-owned asset set and re-executes nothing, so nothing on this path may reach a
 * Target System, a Workspace Provider or an object store. A module that takes rows and
 * returns indices cannot.
 */

/** The three things EXPERIENCE.md's Replay row says a reader may jump to. */
export const REPLAY_JUMP_KINDS = ['work-item', 'exception', 'escalation'] as const;
export type ReplayJumpKind = (typeof REPLAY_JUMP_KINDS)[number];

/**
 * Why a jump target has no frame to open, said only as far as the read can KNOW it.
 *
 * - `none-captured`: the page read every frame the Run has, and none belongs to this target.
 * - `none-before`: no frame was captured at or before the instant an Escalation was raised.
 *   Decidable under ANY bound, because the read holds the EARLIEST frames: if none of them
 *   precedes the instant, none at all does.
 * - `not-read`: the read bound at `REPLAY_FRAME_LIMIT` and none of the frames read belongs
 *   to this target. Whether one exists past the bound is NOT known, so the sentence for it
 *   claims neither that a frame exists nor that none was captured. The first version of this
 *   inferred "beyond the frames shown" from the global count alone, which was a false claim
 *   about a Work Item that captured nothing in a long Run (the Codex finding on PR 36).
 */
export const REPLAY_FRAME_ABSENCES = ['none-captured', 'none-before', 'not-read'] as const;
export type ReplayFrameAbsence = (typeof REPLAY_FRAME_ABSENCES)[number];

/**
 * A jump target either lands on a frame or says why it cannot -- never a null index with no
 * reason, and never a reason beside a frame. A pill that opens nothing is worse than none.
 */
export type ReplayJumpTarget = {
  readonly kind: ReplayJumpKind;
  readonly id: string;
  readonly label: string;
  /** Exact inspection route when its capture is outside the prefix. */
  readonly workItemId?: string;
  /**
   * The inspection page that holds the frame, when it is not that record's first page
   * (Story 10.9). An Escalation lands on the last frame captured at or before it was
   * raised, which can sit anywhere in its record's captures; a Work Item and an Exception
   * land on the record's first frame, which is always on the first page.
   */
  readonly inspectionCursor?: number;
} & (
  | { readonly frameIndex: number; readonly absence: null }
  | { readonly frameIndex: null; readonly absence: ReplayFrameAbsence }
);

/** A page is an explicit, stable inspection offset; it never changes the prefix limit. */
export type ReplayRequest =
  | { readonly kind: 'prefix' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'inspection'; readonly workItemId: string; readonly cursor: number };

export type ReplayWindow =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'inspection'; readonly workItemId: string; readonly label: string;
      readonly total: number; readonly cursor: number;
      readonly previousCursor: number | null; readonly nextCursor: number | null };

export function replayRequest(query: {
  readonly workItem?: string | readonly string[];
  readonly cursor?: string | readonly string[];
}, pageSize: number): ReplayRequest {
  if (query.workItem === undefined && query.cursor === undefined) return { kind: 'prefix' };
  if (typeof query.workItem !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.workItem))
    return { kind: 'unavailable' };
  // Canonical decimal offsets only: duplicates, signs, exponents and leading zeroes refuse.
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(query.cursor)))
    return { kind: 'unavailable' };
  const cursor = query.cursor === undefined ? 0 : Number(query.cursor);
  if (!Number.isSafeInteger(cursor) || cursor > 2_147_483_600 || cursor % pageSize !== 0)
    return { kind: 'unavailable' };
  return { kind: 'inspection', workItemId: query.workItem.toLowerCase(), cursor };
}

/**
 * The Replay viewer's React key: the Run and the REQUEST, and never the time it was read.
 *
 * The key decides when the viewer starts again from its requested frame, paused. A new
 * request must do that — another inspection, another page of one, the whole session —
 * so each is its own key. A re-read of the SAME request must not: the shell's bell
 * re-reads every page whenever any Run ends or a question opens anywhere (`BellLive`),
 * and a key that carried the read time restarted the viewer at its first frame under a
 * reader who was stepping through it. A terminal Run's frames never change, so a re-read
 * has nothing to reset. A full reload still starts paused at the request, because a
 * reload mounts everything anew.
 */
export function replayViewerKey(runId: string, request: ReplayRequest): string {
  switch (request.kind) {
    case 'prefix': return `${runId}:prefix`;
    case 'unavailable': return `${runId}:unavailable`;
    case 'inspection': return `${runId}:inspection:${request.workItemId}:${request.cursor}`;
  }
}

export function replayInspectionHref(runId: string, workItemId: string, cursor = 0): string {
  return `/runs/${encodeURIComponent(runId)}/replay?workItem=${encodeURIComponent(workItemId)}${cursor === 0 ? '' : `&cursor=${cursor}`}`;
}

/** The same Step-first owner used by the stored selected-inspection read. */
export function effectiveFrameWorkItemId(
  frame: Pick<RunFrameRow, 'workItemId'>,
  step: { readonly workItemId: string | null } | null | undefined,
): string | null {
  return step?.workItemId ?? frame.workItemId;
}

export type ReplayInitialSelection =
  | { readonly kind: 'start'; readonly frameIndex: number }
  | { readonly kind: 'inspection'; readonly target: ReplayJumpTarget; readonly frameIndex: number | null }
  | { readonly kind: 'unavailable'; readonly frameIndex: null };

/** Resolve only against this authorized Run's stored targets. A bad or bounded-out
 * deep link must never silently show a different record's first capture. */
export function replayInitialSelection(
  workItem: string | readonly string[] | undefined,
  targets: readonly ReplayJumpTarget[],
  frameCount: number,
): ReplayInitialSelection {
  if (workItem === undefined) return { kind: 'start', frameIndex: clampReplayIndex(0, frameCount) };
  if (typeof workItem !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workItem))
    return { kind: 'unavailable', frameIndex: null };
  const target = targets.find(item => item.kind === 'work-item' && item.id === workItem.toLowerCase());
  return target === undefined ? { kind: 'unavailable', frameIndex: null }
    : { kind: 'inspection', target, frameIndex: target.frameIndex };
}

function landing(frameIndex: number | null, whenMissing: ReplayFrameAbsence):
  | { readonly frameIndex: number; readonly absence: null }
  | { readonly frameIndex: null; readonly absence: ReplayFrameAbsence } {
  return frameIndex === null ? { frameIndex: null, absence: whenMissing } : { frameIndex, absence: null };
}

export interface ReplayWorkItem {
  readonly workItemId: string;
  readonly displayName: string;
  /** The record this Work Item inspected, or null when it inspected no population. */
  readonly subjectKey: string | null;
}


export interface ReplayException {
  readonly exceptionId: string;
  readonly workItemId: string;
  readonly populationRecordKey: string;
}

/**
 * Frames with their Work Item resolved through the Step Execution that captured them.
 *
 * `run_tool_action.work_item_id` is NULLABLE, and a jump matched on it alone reports "no
 * frame was captured here" for a Work Item whose frames all carry the id on their Step
 * Execution instead. The page already resolves the system NAME that way
 * (`step?.workItemId ?? frame.workItemId`); the jump list used the raw column, so the two
 * disagreed on the same row. This is the one rule, applied before either read.
 */
export function resolveFrameWorkItems(
  frames: readonly RunFrameRow[],
  stepExecutions: readonly { readonly stepExecutionId: string; readonly workItemId: string | null }[],
): readonly RunFrameRow[] {
  const byStep = new Map(stepExecutions.map((step) => [step.stepExecutionId, step]));
  return frames.map((frame) => {
    return { ...frame, workItemId: effectiveFrameWorkItemId(frame, byStep.get(frame.stepExecutionId)) };
  });
}

/**
 * The first frame captured while a Work Item was being worked, or `null`.
 *
 * FIRST, not last: jumping to a Work Item means starting at it, and a reader who wants its
 * end steps forward from there. Frames arrive oldest first, so this is the first match.
 */
export function replayFrameForWorkItem(
  frames: readonly RunFrameRow[],
  workItemId: string,
): number | null {
  const index = frames.findIndex((frame) => frame.workItemId === workItemId);
  return index === -1 ? null : index;
}

/**
 * The last frame captured at or before an instant, or `null`.
 *
 * An Escalation asks about a page, and the page it asks about is the last one captured
 * before it was raised. A frame captured AFTER it belongs to whatever happened next, so
 * jumping there would show a reader a screen the question was not about. An unreadable
 * instant is `null` rather than the first frame: guessing where a wait belongs is worse
 * than saying nothing was found for it.
 */
export function replayFrameAt(frames: readonly RunFrameRow[], instant: string): number | null {
  const at = Date.parse(instant);
  if (!Number.isFinite(at)) return null;
  let found: number | null = null;
  for (let index = 0; index < frames.length; index += 1) {
    const startedAt = Date.parse(frames[index]!.actionStartedAt);
    if (!Number.isFinite(startedAt) || startedAt > at) break;
    found = index;
  }
  return found;
}

/**
 * The jump list, in SESSION order.
 *
 * Ordered by the frame each target lands on, so the list reads the way the session ran; a
 * target with no frame sorts last, because it is somewhere a reader cannot go. Ties break
 * on kind then id, so the order is deterministic rather than whatever the reads returned.
 *
 * A PAUSE is not in it. EXPERIENCE.md's Replay row names Work Items, Exceptions and
 * Escalations, and a pause is a wait that asks nothing — the distinction generation 45
 * enforces in the database and `run-pause-v1.md` states.
 */
export function replayJumpTargets(input: {
  readonly frames: readonly RunFrameRow[];
  /** How many frames the Run holds, so a bounded read is known to be one. */
  readonly framesTotal: number;
  readonly workItems: readonly ReplayWorkItem[];
  readonly exceptions: readonly ReplayException[];
  readonly waits: readonly RunReplayWait[];
}): readonly ReplayJumpTarget[] {
  // A Work Item's frames are matched by id, so a bounded read cannot tell "captured nothing"
  // from "captured past the bound"; a complete read can.
  const whenNoFrame: ReplayFrameAbsence = input.framesTotal > input.frames.length ? 'not-read' : 'none-captured';
  const targets: ReplayJumpTarget[] = [];
  for (const item of input.workItems) {
    targets.push({
      kind: 'work-item',
      id: item.workItemId,
      workItemId: item.workItemId,
      label: workItemLabel(item),
      ...landing(replayFrameForWorkItem(input.frames, item.workItemId), whenNoFrame),
    });
  }
  for (const exception of input.exceptions) {
    targets.push({
      kind: 'exception',
      id: exception.exceptionId,
      workItemId: exception.workItemId,
      label: exception.populationRecordKey,
      ...landing(replayFrameForWorkItem(input.frames, exception.workItemId), whenNoFrame),
    });
  }
  for (const wait of input.waits) {
    if (wait.kind === 'pause') continue;
    // The stored kind is a KEY, and this row renders its label in a monospace span --
    // which presents whatever it is given as an identifier. `choose-candidate` is not a
    // question an auditor asked, and the plain-words pass removed exactly this from the
    // authoring screens; Replay reintroduced it in a new place.
    const label = escalationKindWord(wait.kind);
    // The frame an Escalation lands on is decided over EVERY frame the Run holds
    // (`framesThrough`, Story 10.9). When it lies past the frames this page read, landing on
    // the last frame read would show a screen the question was not about -- which is what
    // happened before. It is NOT READ here, and its record's inspection page holds it.
    if (wait.framesThrough > input.frames.length) {
      targets.push({
        kind: 'escalation',
        id: wait.waitId,
        label,
        ...(wait.landing === null
          ? {}
          : { workItemId: wait.landing.workItemId, inspectionCursor: wait.landing.cursor }),
        frameIndex: null,
        absence: 'not-read',
      });
      continue;
    }
    targets.push({
      kind: 'escalation',
      id: wait.waitId,
      label,
      // Decided whatever the bound: the frames read are the earliest, so none preceding the
      // instant among them means none preceding it at all.
      ...landing(replayFrameAt(input.frames, wait.openedAt), 'none-before'),
    });
  }
  const rank = (target: ReplayJumpTarget): number => REPLAY_JUMP_KINDS.indexOf(target.kind);
  return targets.sort((left, right) => {
    if (left.frameIndex !== right.frameIndex) {
      if (left.frameIndex === null) return 1;
      if (right.frameIndex === null) return -1;
      return left.frameIndex - right.frameIndex;
    }
    return rank(left) - rank(right) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
}

/**
 * How many Observations the Run had registered by the time a frame was captured.
 *
 * A running total over the chain's own registration events, compared against the frame's
 * ACTION start — the same instant the frames are ordered by, so the number a reader sees
 * beside a frame is true of the moment that frame was taken. An unreadable instant on
 * either side contributes nothing rather than being treated as zero or as everything.
 *
 * The REFERENCE statement of the rule, and no longer what the page renders (Story 10.9).
 * Fed a bounded page of events it undercounted every frame past the page's last event,
 * so the number beside a frame now comes from `readFrames`, counted in SQL over the WHOLE
 * registration history; `tests/integration/replay-bounded-history.test.ts` holds that SQL
 * to this function over every event the Run recorded.
 */
export function replayObservationsThrough(
  deltas: readonly RunReplayObservationDelta[],
  frame: RunFrameRow | null,
): number {
  if (frame === null) return 0;
  const at = Date.parse(frame.actionStartedAt);
  if (!Number.isFinite(at)) return 0;
  let total = 0;
  for (const delta of deltas) {
    const occurredAt = Date.parse(delta.occurredAt);
    if (Number.isFinite(occurredAt) && occurredAt <= at) total += delta.registered;
  }
  return total;
}

/** Keep a requested position inside the frames that exist; `-1` when there are none. */
export function clampReplayIndex(index: number, frames: number): number {
  if (frames <= 0) return -1;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(frames - 1, Math.trunc(index)));
}

/**
 * What the jump list says when it is bounded (Story 10.9).
 *
 * The page reads the first `REPLAY_PAGE_SIZE` Escalations and Exceptions, each in the order
 * it was raised. It used to stop there and say nothing, so a long Run's jump list read as
 * every question it asked and every Exception it raised. The owner approved these words on
 * 2026-09-26 ("approve all"); the story file records them, and `replay.test.ts` reads them
 * back from it.
 */
export const REPLAY_BOUND_WORDS = {
  escalations: 'Showing the first {shown} of {total} Escalations.',
  exceptions: 'Showing the first {shown} of {total} Exceptions.',
  /** How to reach one the list does not name: through its record's own inspection. */
  rest: 'To see one of the rest, open its record in the record review and choose Replay.',
  /** The words of `rest` that link to the record review. */
  restLink: 'record review',
} as const;

/** The EXACT totals beside the bounded Escalation and Exception pages the jump list reads. */
export interface ReplayJumpTotals {
  /** Every Escalation the Run raised. A pause is a wait that asks nothing, so not one. */
  readonly escalations: number;
  readonly exceptions: number;
}

/**
 * The bound sentence for one kind, or `null` when the list names every one the Run holds.
 * `shown` is how many the list names and `total` how many the Run holds; both are exact,
 * so neither is ever presented as the other.
 */
export function replayJumpBoundSentence(kind: 'escalation' | 'exception', shown: number, total: number): string | null {
  if (total <= shown) return null;
  return fillTemplate(kind === 'escalation' ? REPLAY_BOUND_WORDS.escalations : REPLAY_BOUND_WORDS.exceptions, {
    shown: shown.toLocaleString('en-US'),
    total: total.toLocaleString('en-US'),
  });
}

/**
 * What Replay says about the gaps in a session (Story 10.6, legacy 5.2).
 *
 * Replay played the frames a Run registered and said nothing about the Tool Actions that
 * left none, so a session with a gap looked complete. Every sentence here is PROPOSED
 * wording (the story's Ask First rule): it is not in the UX artifacts yet. A suppressed
 * capture is NOT here — it says the platform's existing `captureSentence`, because it is
 * the credential guarantee working and has its own words already.
 */
export const REPLAY_GAP_WORDS = {
  /** The rail section that lists where the gaps sit. */
  heading: 'Gaps in this playback',
  /** A position where a frame was owed and none was saved. */
  missing: 'Missing frame',
  /** The disclosure that holds the positions. */
  listSummary: 'Where the gaps are',
  bounded: 'Showing the first {shown} of {total} gaps.',
} as const;

/**
 * The limitation, stated rather than implied: how many frames are missing and that the
 * playback is incomplete. `missing` is the EXACT count, never the length of a bounded list.
 */
export function replayIncompleteSentence(missing: number): string {
  return missing === 1
    ? 'Playback is incomplete: 1 frame is missing.'
    : `Playback is incomplete: ${missing.toLocaleString('en-US')} frames are missing.`;
}

/** Where a gap sits, in the scrubber's own numbering. */
export function replayGapPosition(framesBefore: number): string {
  return framesBefore <= 0 ? 'before the first frame' : `after frame ${framesBefore.toLocaleString('en-US')}`;
}

/** One gap, as the viewer renders it: already in words, with its position. */
export interface ReplayGapView {
  readonly toolActionId: string;
  readonly kind: 'missing' | 'suppressed';
  /** "Missing frame", or the platform's capture sentence for a suppressed capture. */
  readonly mark: string;
  /** What the action was, in audit words — never the stored identifier. */
  readonly narration: string;
  /** How many frames come before it in the scrubber's order. */
  readonly framesBefore: number;
}

export interface ReplayGapsView {
  /** The exact number of missing frames. Suppressed captures are never counted here. */
  readonly missing: number;
  readonly suppressed: number;
  readonly rows: readonly ReplayGapView[];
}

/**
 * The gaps that sit at one scrubber position: after `position` frames, before the next.
 *
 * Only the positions the scrubber actually renders get a marker; a gap after a frame past
 * the frame read's bound is still in the list and still counted, never dropped.
 */
export function replayGapsAt(gaps: ReplayGapsView | undefined, position: number): readonly ReplayGapView[] {
  if (gaps === undefined) return [];
  return gaps.rows.filter((gap) => gap.framesBefore === position);
}
